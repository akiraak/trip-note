# プランの途中の日を追加・削除できるようにする(後続の日付をずらす)

## 目的・背景

旅程を組み替えるときに「途中に 1 日足す」「途中の 1 日を抜く」ができない。

- 5 日ある予定の 2 日目に日を足したら、以降が 1 日ずつ後ろにずれて全 6 日になってほしい
- 逆に 2 日目を削除したら、以降が 1 日ずつ前に詰まって全 4 日になってほしい

現状:

- 日の追加は**最終日の翌日**のみ(iOS `PlanEditor.addedDay(to:)` /
  Web `addTripDay(tripId)`。どちらも `max(date) + 1 日`)
- 日の削除は**できるが後続を詰めない**(iOS 日詳細の「この日を削除」/
  Web 日カードの「削除」。どちらも tombstone を立てるだけ)。途中の日を消すと
  日付に穴が空き、以降の日付が実際の旅程とずれる
- iOS は旅行画面のプラン一覧から削除できず、日詳細を開く必要がある(導線が分かりにくい)

### データモデル上の前提

- **日の順序は `trip_days.date` だけで決まる**(順序カラムは無い)。
  iOS は `TripEntity.sortedDays`(date 昇順)、Web は
  `app/trips/[id]/page.tsx:57` の `order by date`
- 「N日目」は配列インデックス由来なので、**日付をずらせば番号は自動で追従する**
- `checkpoints.planned_time` は日付込みの絶対時刻。日をずらすときは
  **同じ日数だけ planned_time もずらす**必要がある
- `trip_days.departure_time` は `"HH:MM"` なので触らない
- `trips.departure_at`(プラン 1 日目の基準)は、後述の操作では 1 日目の日付が
  変わらないため変更しない
  - 「この日の後に追加」なので 1 日目より前には日が入らない
  - 1 日目を削除した場合は 2 日目以降が 1 日前に詰まり、**新しい 1 日目が
    元の 1 日目の日付を引き継ぐ**
- スキーマ変更なし。`/api/sync` は `trip_days.date` と `checkpoints.planned_time` を
  LWW upsert 済み(`web/src/app/api/sync/route.ts:194` 以降)なのでサーバ変更は不要

## 対応方針

### 操作の仕様

| 操作 | 挙動 |
| --- | --- |
| ある日の「この日の後に日を追加」 | その日より後の日をすべて +1 日ずらし、`その日の日付 + 1 日` の空の日を作る。1 日目で実行すれば新しい日が 2 日目になる |
| 最終日の「この日の後に日を追加」 | ずらす対象が無いので、既存の「日を追加」と同じ結果になる |
| 日の削除 | その日(と配下のチェックポイント)を tombstone にし、**後続の日をすべて -1 日ずらす** |
| 最終日の削除 | ずらす対象が無いので現状と同じ |

- 日付に既に穴がある場合(手動で崩れたケース)も「後続を一律 ±1 日」で扱う。
  相対的な間隔は保たれ、日付の重複も起きない
- ずらした行だけ `updated_at` を編集時刻に進める(LWW で他方の編集を潰さないため)。
  `planned_time` が `null` のチェックポイントは触らない

### Phase 1: 日付シフトの共通ロジック

**Web (`web/src/lib/plan.ts`)**

- 内部ヘルパ `shiftDaysAfter(tripId, afterDate, offsetDays, now)`
  - 対象の日 id を先に `select`(`date > afterDate and deleted_at is null`)してから
    更新する(更新後に条件が変わる順序依存を避ける)
  - `trip_days.date` は SQLite の `date(date, '+1 day' | '-1 day')` で更新
  - 対象日に紐づく `checkpoints` のうち `planned_time is not null and deleted_at is null`
    のものを JS 側でずらして書き戻す
  - すべて 1 トランザクション(`db.transaction`)で実行する
- `planned_time` のずらしは壁時計時刻を保つヘルパ
  `shiftIsoByDays(iso, offsetDays)` を用意する
  (`+24h` した後、表示 TZ (`TIME_ZONE`) のオフセット差分を打ち消す。
  DST 跨ぎでも `09:00` が `09:00` のままになる)
- 公開関数
  - `insertTripDayAfter(dayId): TripDay` — 上記シフト(+1)後に新しい日を insert
  - `deleteTripDay(dayId)` を変更 — 既存の tombstone 処理の後にシフト(-1)を行う
- `addTripDay(tripId)`(末尾追加)は現状のまま残す

**iOS (`ios/TripNote/Domain/PlanEditor.swift`)**

- `static func shiftDays(after day: TripDayEntity, by offsetDays: Int, calendar:, now:)`
  - `day.trip?.sortedDays` のうち `date > day.date` の日を対象に、
    `date` を `calendar.date(byAdding: .day, ...)` でずらす
  - 各日の `sortedCheckpoints` のうち `plannedTime != nil` のものも同じ日数ずらす
  - 変更した行のみ `updatedAt = now` / `needsSync = true`
- `static func insertedDay(after day: TripDayEntity, calendar:, now:) -> TripDayEntity?`
  - シフト(+1)を行い、`day.date + 1 日` の `TripDayEntity` を返す(挿入は呼び出し側)
- `static func deleteShiftingFollowing(_ day: TripDayEntity, calendar:, now:)`
  - 既存の `delete(_ day:now:)` を呼んでからシフト(-1)を行う
  - 既存の `delete(_ day:)` は据え置き(旅行削除 `delete(_ trip:)` から使う。
    全日を消すためシフトは不要)

### Phase 2: Web の UI

- `app/trips/[id]/actions.ts` に `insertDayAfterAction(dayId)` を追加
  (実処理は `lib/plan.ts`、成功時 `revalidateTrip`)
- `app/trips/[id]/plan-section.tsx`
  - 日カードのフッタ(チェックポイント追加ボタンの並び)に
    `+ この日の後に日を追加` を追加する
  - 削除の確認文言を更新: 「この日とチェックポイント N 件を削除し、
    以降の日を 1 日前にずらします」(最終日なら後半を出さない)
  - 画面下部の `+ 日を追加`(末尾追加)は残す

### Phase 3: iOS の UI

- `Views/TripDetailView.swift` のプラン一覧の各行に swipe アクションを追加
  - 先頭側(leading): 「次の日を追加」(`PlanEditor.insertedDay(after:)` →
    `modelContext.insert` → `save` → `sync.syncNow()`)
  - 末尾側(trailing, destructive): 「削除」。確認ダイアログで
    「以降の日が 1 日前にずれます」を明示する
  - 行は `NavigationLink` のままにする(タップ遷移を壊さない)
- `Views/TripDayDetailView.swift` の「この日を削除」を
  `PlanEditor.deleteShiftingFollowing(_:)` に切り替え、確認ダイアログの message に
  後続がずれる旨を追記する
- 日詳細からの「次の日を追加」は入れない(旅行画面の一覧で足りる。スコープ外)

### Phase 4: テストと後片付け

- 下記「テスト方針」の自動テストを追加し、iOS / Web のビルドとテストを通す
- `TODO.md` の該当項目を `DONE.md` へ移し、本プランを `docs/plans/archive/` へ移動する

## 影響範囲

- Web: `src/lib/plan.ts` / `src/lib/format.ts`(TZ ヘルパを置く場合) /
  `src/app/trips/[id]/actions.ts` / `src/app/trips/[id]/plan-section.tsx`
- iOS: `Domain/PlanEditor.swift` / `Views/TripDetailView.swift` /
  `Views/TripDayDetailView.swift`(新規ファイルは追加しないので
  `xcodegen generate` は不要)
- DB スキーマ・`/api/sync`・`docs/specs/server-api.md`: 変更なし
- デプロイ: Web の変更があるため g3plus の再ビルドが必要
  (手順は `../g3plus-ops/docs/workflows/trip-note.md`)

## リスク・留意点

- **LWW との相性**: シフトは行単位の `updated_at` 更新なので、同じ日を別デバイスで
  同時に編集していると片方の変更が勝つ。単一ユーザー運用のため許容する
- **一括更新の量**: 1 回の操作で「ずらした日数 + その日の planned_time 付き
  チェックポイント数」の行が更新される(せいぜい数十行)。同期の pull で
  まとめて流れるが実用上問題ない
- **DST 跨ぎ**: `planned_time` は絶対時刻なので単純な +24h だと壁時計が 1 時間ずれる。
  Web は `shiftIsoByDays` のオフセット補正で、iOS は `Calendar` の日加算で吸収する
- **到着予想・ミニ地図**: どちらも `day.date` と `departure_time` から表示時に導出する
  (`Domain/ArrivalEstimator.swift`)ため、日付シフト後に自動で追従する
- 日付に穴があるプランで「後続を一律 ±1 日」すると穴は埋まらない
  (今回は連続性の自動修復まではやらない)

## テスト方針

- Web ユニットテスト(`web/test/plan.test.ts` に追加。既存同様に一時 DB を使う)
  - 途中に追加: 後続の `date` が +1 日、その日の `planned_time` も +1 日、
    新しい日が `選択日 + 1 日` で作られ、日数が 1 増える
  - 最終日の後に追加: シフト対象が無く、末尾に 1 日増えるだけ
  - 途中の削除: 対象日と配下チェックポイントが tombstone、後続が -1 日
  - 最終日の削除: シフトが起きない
  - tombstone 済みの日・チェックポイントはずらさない
  - `planned_time` が null のチェックポイントの `updated_at` は進まない
  - 1 日目を削除しても残った先頭の日付が元の 1 日目と同じになる
- iOS ユニットテスト(`ios/TripNoteTests/PlanEditorTests.swift` に追加。
  unmanaged エンティティで組む)
  - 上記と同じケース + `updatedAt` / `needsSync` が「変更した行だけ」立つこと
- 手動確認
  - iOS: 5 日のプランの 1 日目から「次の日を追加」→ 全 6 日になり以降が 1 日ずれる。
    2 日目を削除 → 全 5 日に戻る。ミニ地図・距離・到着予想が壊れない
  - Web: 同じ操作を行い、同期後に iOS と日付が一致する
- `xcodebuild build` / `test`、`npm run lint` / `npm run build` / `npm test` の通過
