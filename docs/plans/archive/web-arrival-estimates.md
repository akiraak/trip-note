# Web のチェックポイントに到着予想時刻を出す

## 目的・背景

iOS の日詳細(`TripDayDetailView` の `CheckpointRow`)は、手入力の予定時刻が無いチェックポイントに
**到着予想「HH:MM 頃」**を出している(`ios/TripNote/Domain/ArrivalEstimator.swift`)。
Web の日カード(`plan-section.tsx` の `CheckpointRow`)は `planned_time` があるときしか時刻を出しておらず、
同じデータを見ているのに **Web からは到着予想が見えない**。

CLAUDE.md の「iOS と Web で表示情報を揃える」に反する差分なので、iOS の `ArrivalEstimator` 相当を
TypeScript に移して Web の日カードにも出す。
(`docs/plans/archive/web-ios-info-parity.md` でレグ解決待ちとして先送りしていた項目。
レグ解決は `use-route-legs.ts` で入っているので、いま実装できる)

## 対応方針(Web の表示のみ。DB スキーマ・API・同期契約・iOS は変更なし)

### Step 1: 到着予想の純ロジックを TypeScript に移す

`web/src/lib/arrival.ts` を新設。iOS の `ArrivalEstimator` と同じ規則にする。

- `departureDateTime(dayDate, departureTime)`: `YYYY-MM-DD` + `"HH:MM"` → `Date`
  (不正な日付・時刻は `null`)
- `arrivalEstimates({ dayDate, departureTime, routeStart, checkpoints, resolved })`:
  チェックポイント id → 到着予想 `Date` のマップ
  - anchor は日の出発時刻から始まり、`planned_time` のある CP でその値に置き換えて再連鎖する
    (その CP 自体は予想を出さない。1 日目は出発 CP の `planned_time` が自然に anchor になる)
  - 各 CP の予想 = anchor + anchor 以降のレグ所要時間(`durationS`)の累積
  - anchor が無い区間と未解決レグ以降は予想なし(次の `planned_time` 付き CP で再開)
  - 座標なし CP は予想なし。レグは `buildLegs` と同様にそれを飛ばして連鎖を続ける
- レグキーと丸め粒度は `lib/route-legs.ts` を使う(`isDegenerate` を export して共有する)
- タイムゾーンは既存の予定時刻表示と同じ**ブラウザのローカル TZ**
  (iOS の「端末の Calendar 基準」と同じ扱い。`checkpoint-form.tsx` の入出力もローカル TZ)

### Step 2: 日カードのチェックポイント行に出す

- `DayCard` が既に持っている `legs` / `resolved`(`useRouteLegs`)/ `map.anchor` から
  到着予想を求め、`CheckpointRow` に渡す
- `CheckpointRow` は `planned_time` があればそれを、無ければ**「HH:MM 頃」**を出す
  (iOS と同じ優先順・同じ文言。OSRM の自由流走行時間ベースの概算なので常に「頃」)
- SSR とブラウザで TZ がずれ得るので、既存の予定時刻表示と同じく `suppressHydrationWarning`

### Step 3: 記録の追従

- `docs/plans/archive/web-ios-info-parity.md` の「スコープ外」に対応済みの追記を入れる

## 影響範囲

- web(追加): `src/lib/arrival.ts` / `test/arrival.test.ts`
- web(変更): `src/lib/route-legs.ts`(`isDegenerate` の export)/
  `src/app/trips/[id]/plan-section.tsx`
- iOS・DB スキーマ・`/api/*`・同期契約: 変更なし
- デプロイ: 通常の rebuild のみ

## テスト方針

- vitest(`test/arrival.test.ts`): iOS の `ArrivalEstimatorTests` と同じケースを移植する
  - 出発時刻からレグ所要時間を累積する / `planned_time` で再アンカーしその CP は予想なし /
    未解決レグ以降は予想なしで次の `planned_time` から再開 / 出発時刻も手前の
    `planned_time` も無ければ予想なし / 座標なし CP は飛ばして連鎖 / 1 日目は出発 CP が anchor /
    不正な出発時刻は `null`
- `npm run lint` / `npm run build` / `npm test`
- 手動(`npm run dev`): 出発時刻を設定した日で「HH:MM 頃」が出ること、
  予定時刻のある CP はそのまま予定時刻が出ること

## スコープ外

- 滞在時間のモデル化(iOS と同じく「その CP を出る時刻」扱いのまま)
- 未解決レグの直線距離フォールバックでの所要推定(iOS と同じく予想を打ち切る)
