# 日詳細画面の編集強化(AI 検索からの追加・目的地の宿泊化・出発時刻と到着予想)

## 目的・背景

TODO「プランの各日をタップしたら日の詳細画面を表示」の子項目 3 つに対応する。
調査の結果、土台はほぼ実装済みで、実際のギャップは以下に絞られる。

すでにある(確認のみ):

- 日行タップ → 日詳細への遷移(`TripDetailView` の `NavigationLink` →
  `TripDayDetailView`)
- チェックポイントの追加(`CheckpointSearchView` の MKLocalSearch 検索 +
  AI 検索補助 `/api/ai/search-assist` + 手入力)、編集(`CheckpointEditView`。
  名前・種別 Picker・座標検索・予定時刻・メモ)、削除・ドラッグ並び替え
- 目的地チェックポイント(最終日の `type=destination`)も他と同じく行タップで
  編集でき、種別 Picker で「宿泊」へ変更自体は可能

足りないもの(本プランの対象):

1. **AI 検索候補のワンタップ追加ができない**: `/api/ai/search-assist` の候補
   (`AISuggestedPlace`)は `type/name/area/note` のみで座標がなく、候補は
   「検索クエリに入れて MKLocalSearch し直す」二段構え専用になっている
2. **目的地 → ホテルの置き換えが手作業**: `CheckpointEditView` の
   「検索して位置を設定」は名前が入力済みだと座標しか上書きしない
   (`CheckpointEditView.swift` の `trimmedName.isEmpty` ガード)。
   目的地「シカゴ」をホテルに変えるには名前・種別を手で直す必要がある
3. **出発時刻・到着予想時刻が存在しない**: 日単位の出発時刻フィールドがなく
   (`TripDayEntity` は `date/title/note` のみ)、到着予想の計算ロジックもない。
   時刻は `CheckpointEntity.plannedTime`(手入力)だけ

## 対応方針

### Phase 1: AI 検索候補のワンタップ追加(web + iOS)

AI 候補に概算座標を持たせ、候補から直接チェックポイントを追加できるようにする。
「AI の座標は信用しない」方針は維持し、概算座標はあとから検索で上書きする前提
(plan / trip-outline に概算座標を追加したときと同じパターン)。

1. **web**: `lib/ai.ts` の `SEARCH_ASSIST_SCHEMA` / `buildSearchAssistPrompt` /
   `parseSearchAssistSuggestion` に候補の概算座標(`latitude` / `longitude`)を
   追加する。範囲外・非数値はパースで null に落とす。
   search-assist は同期 API のまま(ai-async-jobs での残置方針を踏襲)
2. **iOS**: `AIRecords.swift` の `AISuggestedPlace` に概算座標(任意)を追加。
   `CheckpointSearchView` の AI 候補行に「追加」ボタンを付け、座標ありの候補は
   `PlaceSelection` 相当としてそのまま `onSelect` に流す(種別は AI の `type` を
   使用)。座標なし候補は従来通り検索クエリへの反映のみ
3. 既存の「候補名で MKLocalSearch して座標を確定してから追加」の動線は残す
   (概算のまま追加 → あとで編集画面の検索で具体化、も既存の上書きフローで可能)

### Phase 2: 目的地をホテルなどの宿泊地に変更しやすくする(iOS のみ)

1. `CheckpointEditView` の検索確定時、名前が空のときだけでなく**常に**検索結果の
   名前・種別で置き換える(座標と同様)。フォームは保存するまで確定しないので、
   意図しない置き換えはキャンセルで戻せる
   - これで「目的地 CP を開く → ホテルを検索 → 名前・種別(宿泊)・座標が
     まとめて入る → 保存」の一連が成立する
2. `trip.destination`(旅行の見出しとしての目的地文字列)は変更しない。
   最終日 CP の扱い(`type` が `destination` でなくなる)に依存する箇所がないことを
   確認する(ルート・地図は座標ベースで種別に依存しない想定)

### Phase 3: 出発時刻の編集と到着予想時刻(web + iOS、同期契約の変更あり)

**日単位の出発時刻を新設し、到着予想は保存せず表示時に導出する。**
予想値を各 CP の `plannedTime` に書き込む案は不採用
(全 CP の `updatedAt`/`needsSync` が動いて LWW で Web 側の編集を潰す +
同期バーストになる + 手入力の予定時刻が消えるため)。

1. **スキーマ: `trip_days.departure_time`(TEXT "HH:MM"、nullable)を追加**
   - その日の宿泊地(前泊地)を出発する時刻。日付は `date` が持つので時刻のみ
   - web: `db.ts` にマイグレーション、`types.ts`、`/api/sync`(push)・
     `/api/sync/pull` の両方向、`lib/plan.ts` の `updateTripDay`、
     `docs/specs/server-api.md` を更新。Web 閲覧 UI の編集対応はスコープ外
     (値の同期と保持のみ)
   - iOS: `TripDayEntity.departureTime: String?`、`SyncRecords.swift`
     (`TripDayRecord`。null を明示 encode する既存規約に合わせる)、
     `PullRecords.swift`、`PlanPull.swift`(LWW 適用)
   - 旧クライアント互換: nullable カラムのため `departure_time` を送らない
     push も受ける
2. **到着予想の純関数 `Domain/ArrivalEstimator.swift`(新規)**
   - 入力: 日の出発時刻(任意)、`sortOrder` 順の CP 列(`plannedTime` 任意・
     座標なし CP あり)、レグ所要時間(`durationS`。未解決レグは nil)
   - 規則:
     - anchor = 日の出発時刻。リストを前から走査し、各 CP の到着予想 =
       anchor + そこまでのレグ `durationS` の累積
     - CP に手入力の `plannedTime` があれば、その CP 以降の anchor を
       `plannedTime` に置き換えて再連鎖する(= その CP を出る時刻として扱う。
       滞在時間のモデル化の代わりで、1 日目は出発 CP の `plannedTime` =
       `trip.departureAt` が自然に anchor になる)
     - anchor が無い区間(出発時刻未設定かつ手前に `plannedTime` 付き CP が
       ない)と、未解決レグ(`durationS` 不明)以降は「予想なし」を返す
     - 座標なし CP は予想なし。レグは既存のレグ組み立てと同様にそれを飛ばして
       連鎖を続ける
3. **iOS UI(`TripDayDetailView`)**
   - 日情報セクションに「出発時刻」を表示し、`TripDayEditView` に編集 UI を追加
     (Toggle + hourAndMinute の DatePicker。保存規約は既存どおり
     `updatedAt` → `needsSync` → save → `syncNow()`)
   - `CheckpointRow` に「到着 12:34頃」を表示(手入力 `plannedTime` がある CP は
     従来通り `plannedTime` を表示し、予想は出さない)
   - レグ所要時間は `.task(id: レグキー列)` で `resolvedLegs(for:)` から取得する
     (メモリキャッシュ 2 段があるため地図側と重複リクエストにならない)。
     出発時刻の編集・CP の追加・並び替えで `.task` の id が変わり自動再計算
4. **依存**: `durationS` のプラミングは
   [plan-day-distance](plan-day-distance.md) の `ResolvedRouteLeg` に乗るため、
   そちらを先に実施する

## 影響範囲

- web(デプロイ必要): `src/lib/ai.ts` / `src/lib/db.ts`(マイグレーション)/
  `src/lib/types.ts` / `src/lib/plan.ts` / `src/app/api/sync/`(push・pull)/
  `docs/specs/server-api.md` / `test/`(vitest)
- iOS: `Models/Entities.swift` / `Models/AIRecords.swift` /
  `Models/SyncRecords.swift` / `Models/PullRecords.swift` /
  `Domain/PlanPull.swift` / `Domain/ArrivalEstimator.swift`(新規)/
  `Views/CheckpointSearchView.swift` / `Views/CheckpointEditView.swift` /
  `Views/TripDayDetailView.swift`
- 新規ファイル追加のため `xcodegen generate` を再実行する

## リスク・留意点

- 到着予想は OSRM の自由流走行時間で渋滞・休憩を含まない → 常に「頃」表記。
  滞在時間はモデル化せず、必要なら CP の `plannedTime` 手入力で anchor を
  補正してもらう(将来の拡張余地として滞在時間フィールドはあり得るが今回は見送り)
- `departure_time` を "HH:MM" のローカル時刻文字列にするのは `date`(YYYY-MM-DD)
  と同じタイムゾーン素朴表現に合わせるため。`plannedTime`(Date)との比較は
  既存の `defaultPlannedTime` と同様 `Calendar.current` で日付と合成する
  (海外旅行での端末 TZ ずれ問題は既存の `plannedTime` と同等のまま)
- Phase 2 の「検索で名前・種別を常に置き換え」は、座標だけ直したいケースで
  名前が変わる副作用がある。フォーム内の置き換えでキャンセル可能なこと、
  検索は位置設定の主動線であることから許容する(検討した代替案:
  置き換え確認ダイアログ = 毎回の追加タップが過剰。名前だけ保持ボタン = 過剰設計)
- AI 概算座標の信頼性は plan / trip-outline と同等(地図上おおよそ)。
  検索での上書き(具体化)フローを必ず残す

## テスト方針

- web(vitest): search-assist の座標パース(正常 / 範囲外 → null / 旧応答に
  無し → null)、`trip_days.departure_time` の push・pull 往復、マイグレーション、
  `updateTripDay` の更新
- iOS(unmanaged エンティティのユニットテスト):
  - `ArrivalEstimator`: 出発時刻からの連鎖計算 / `plannedTime` での再アンカー /
    未解決レグ以降の打ち切り / anchor なし → 予想なし / 座標なし CP スキップ /
    1 日目(出発 CP の `plannedTime` が anchor になる)
  - DTO: `TripDayRecord` の `departureTime` encode(null 明示)/ decode、
    `AISuggestedPlace` の座標 decode(無し → nil)
  - `PlanPull`: `departureTime` の LWW 適用
- 手動(シミュレータ + dev サーバ): AI 候補のワンタップ追加 → 検索で具体化、
  目的地 CP をホテル検索で宿泊に置き換え、出発時刻の編集で以降の到着予想が
  連動して変わる、Web との同期往復で `departure_time` が保持される
- `npm run lint` / `npm run build` / `xcodebuild build` / `test` の通過
