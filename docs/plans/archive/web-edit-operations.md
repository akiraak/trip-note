# Web にも iOS と同じ編集操作を用意する

## 目的・背景

表示情報の突き合わせ(`docs/plans/archive/web-ios-info-parity.md`)で、**表示ではなく操作**の差として
3 つが残った。iOS でしかできないので、Web だけを開いているときに直せない。

| 操作 | iOS の出どころ | Web の現状 |
| --- | --- | --- |
| 旅行の編集(タイトル・出発予定日時・目的地) | `TripEditView`(`TripCreateView.swift`) | 無し。作成時にしか決められない |
| 旅行を終了する | `TripDetailView` の「旅行を終了」→ `LocationRecorder.endTrip` | 無し |
| 日の出発時刻の編集 | `TripDayEditView` の Toggle + DatePicker | 無し(表示は 2026-08-23 に追加済み) |

`lib/plan.ts` の `updateTripDay` は既に `departure_time` を受け付けるので、3 つ目は UI と Action だけ。

## 対応方針(Web のみ。DB スキーマ・API・同期契約・iOS は変更なし)

すべて `lib/plan.ts` に純ロジックを置き、Server Action は結果整形と `revalidatePath` のみ(既存の作法)。

### Step 1: `lib/plan.ts` に `updateTrip` / `endTrip`

- `updateTrip(tripId, input)` — iOS `TripEditView.save()` の移植
  - `title` は trim して必須(空ならエラー)
  - `departure_at` は**日付 + 時刻を分けて受け取り、表示 TZ の壁時計として ISO に変換**する
    (既存の `isoFromLocalWallClock`。ブラウザのローカル TZ で解釈すると日付がずれ得るため。
    `createTrip` と同じ扱い)。日付が null なら出発予定を消す
  - `destination` は trim して空なら null
  - **`transport` は `car` に正規化する**(iOS と同じ。古い旅行の null もここで揃う)
  - **プランの日付は動かさない**(iOS も動かさない。1 日目の日付は作成時に決まる)
- `endTrip(tripId)` — `ended_at` に現在時刻を入れる
  - iOS は記録中なら記録も止めるが、Web は記録しないので `ended_at` だけ
  - **進行中(started_at あり・ended_at なし)以外はエラー**にする
    (iOS も `status == .inProgress` のときしかボタンを出さない)

### Step 2: Server Actions

`trips/[id]/actions.ts` に `updateTripAction` / `endTripAction` を足し、
`updateDayAction` の `fields` に `departure_time` を通す(`lib/plan.ts` 側は対応済み)。

### Step 3: 旅行画面の UI

- `trips/[id]/edit-trip.tsx`(新規・client): タイトル右の「編集」で開閉するフォーム。
  項目は iOS と同じ タイトル / 出発日時(設定するかのチェック + date + time)/ 目的地。
  日付・時刻の扱いと注記は `trips/new/trip-create-form.tsx` に合わせる
- `trips/[id]/end-trip.tsx`(新規・client): **進行中のときだけ**出す「旅行を終了」。
  `delete-trip.tsx` と同じ二段階確認。iOS の footer 文言
  「記録の停止では旅行は終了しません。終了すると一覧で『進行中』ではなくなります。」も出す
  - 記録は iOS 側の話なので Web の文言は「iOS の記録も止まりません」ではなく iOS の原文のままにする

### Step 4: 日の出発時刻の編集

`plan-section.tsx` の `DayForm` に `<input type="time">` を足す(**空 = 未設定**)。
iOS の Toggle + DatePicker と同じ意味を HTML の素の挙動で表す。

## 影響範囲

- web(新規): `src/app/trips/[id]/edit-trip.tsx` / `src/app/trips/[id]/end-trip.tsx`
- web(変更): `src/lib/plan.ts` / `src/app/trips/[id]/actions.ts` /
  `src/app/trips/[id]/page.tsx` / `src/app/trips/[id]/plan-section.tsx`
- DB スキーマ・`/api/*`・同期契約・iOS: 変更なし
- 同期: `trips.updated_at` / `trip_days.updated_at` が進むので `/api/sync/pull` で iOS に流れる
- デプロイ: 通常の rebuild のみ

## テスト方針

- vitest(`test/plan.test.ts` に追加)
  - `updateTrip`: タイトル必須 / 出発日時の壁時計変換 / 出発予定を消す / 目的地の trim →
    null / transport が car に正規化される / 日の日付が動かないこと
  - `endTrip`: `ended_at` が入る / 進行中でなければエラー(未出発・終了済み)
  - `updateTripDay`: 出発時刻の設定・クリア(既存の検証に追加)
- `npm run lint` / `npm run build`
- 手動(`npm run dev`): 編集 → 反映、終了 → バッジが消える、出発時刻の設定・クリア

## スコープ外

- 走行距離・到着予想・破線プランルート → `docs/plans/web-plan-route.md`
- GPS 記録・撮影(iOS 固有)
- 旅行の「再開」(終了を取り消す操作。iOS にも無い)
