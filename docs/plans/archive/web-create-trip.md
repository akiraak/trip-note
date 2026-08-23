# Web から旅行を作成できるようにする

## 目的・背景

Web は「閲覧 + プラン編集」はできるが、**旅行そのものを作れない**。
旅行の新規作成は iOS の `TripCreateView` だけにあり、Web はトップの空状態でも
「iOS アプリで記録して同期するとここに表示されます」と案内している。

現状の確認結果:

- `web/src/app/` に作成用のページが無い(トップの一覧と `trips/[id]/` だけ)
- Server Actions (`app/trips/[id]/actions.ts`) にも作成系が無い
  (day / checkpoint の追加・更新・削除と `deleteTripAction` のみ)
- `lib/plan.ts` にも trip を作る関数が無い(`deleteTrip` はある)
- `insert into trips` は `app/api/sync/route.ts`(iOS からの同期 upsert)と
  `lib/db.ts` のマイグレーションだけ

Mac だけ開いているときに旅行を起こせないのが不便なので、iOS と同じ入力で
Web からも作れるようにする。

### iOS 側の作成仕様(合わせる対象)

`ios/TripNote/Views/TripCreateView.swift` → `Domain/PlanEditor.makeTrip`:

| 項目 | 挙動 |
| --- | --- |
| タイトル | 必須 |
| 出発日時 | 必須。`trips.departure_at`(実績の `started_at` とは別) |
| 移動手段 | `car` 固定(選択 UI は持たない) |
| 目的地 | 任意。`trips.destination` |
| 出発地 | 任意。入力があれば **1 日目に `departure` チェックポイント**を作る (`planned_time` = 出発日時、`sort_order` = 0、座標は取れていれば付ける) |
| 日 | 出発日時の日付で **1 日目だけ**作る(日数は作成時に決めない) |
| `started_at` / `ended_at` | null のまま(= プラン中) |

作成後に目的地があれば AI の日数・宿泊地候補ステップへ進む。

## 対応方針

### スコープ

- **入れる**: 旅行の作成(タイトル・出発日時・出発地・目的地) + 1 日目 +
  出発チェックポイント、トップからの導線
- **入れない**: 作成後の AI 日数・宿泊地候補ステップ(iOS の `trip_outline`)。
  Web には未実装の UI で規模が別なので後続タスクにする。作成後の旅行画面には
  既存の AI 行程提案 (`ai-plan.tsx`) があるので日程は組める

スキーマ変更なし。同期も既存のままで良い(`/api/sync/pull` は trips を全件返し、
iOS 側 `PlanPull.makeTrip` が未知の trip を新規作成する)。

### 出発日時のタイムゾーン

`trips.departure_at` の表示は `formatDateTime`(= `TIME_ZONE`
= America/Los_Angeles)、`trip_days.date` は日付だけの文字列。
ブラウザのローカル TZ で解釈すると **入力した日付と 1 日目の日付がずれ得る**ため、
フォームは日付 (`YYYY-MM-DD`) と時刻 (`HH:mm`) を分けて送り、サーバ側で
**表示タイムゾーンの壁時計として** ISO に変換する。

- 1 日目の `date` = 入力された日付そのもの
- `departure_at` = その日付・時刻を `TIME_ZONE` で解釈した瞬間
  (DST を跨いでもずれないよう `shiftIsoByDays` と同じくオフセット差分で補正)

これで「入力した日付 = 1 日目」「旅行画面の出発予定日時 = 入力した通り」になる。

### 変更点

| ファイル | 内容 |
| --- | --- |
| `web/src/lib/plan.ts` | `createTrip(input)` を追加。trips / trip_days / checkpoints を 1 トランザクションで作る。壁時計 → ISO の変換ヘルパも同ファイルに置く |
| `web/src/app/trips/new/actions.ts` | `createTripAction`。成功したら `revalidatePath("/")` して作成した id を返す |
| `web/src/app/trips/new/page.tsx` | 作成フォーム(client)。出発地は `PlaceLink` を再利用して Google Maps のリンクから座標も入れられるようにする |
| `web/src/app/page.tsx` | 「旅行を作成」への導線。空状態の文言も直す |

`PlaceLink` (`app/trips/[id]/place-link.tsx`) はチェックポイント編集で使っている
汎用コンポーネントなのでそのまま import して使う(移動はしない)。

## 影響範囲

- 既存の閲覧・編集・同期の挙動は変えない(追加のみ)
- iOS 側の変更なし。Web で作った旅行は次の pull で iOS に現れる
- DB スキーマ変更なし

## テスト方針

- `web/test/plan.test.ts` に `createTrip` のケースを追加
  - trip / 1 日目 / 出発チェックポイントが作られる(`transport` = car、
    `started_at` は null、`sort_order` = 0)
  - 出発地が空なら checkpoint を作らない
  - 1 日目の `date` = 入力日付、`departure_at` が壁時計通りに変換される
  - タイトル未入力・不正な日付/時刻はエラー
- `npm run lint` / `npm run build` / `npm test`
- 手動: `npm run dev` でトップ → 作成 → 旅行画面が開くこと
