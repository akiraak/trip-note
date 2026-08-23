# Web の旅行作成にも AI の日数・宿泊地候補ステップを出す

## 目的・背景

Web から旅行を作れるようにした（`docs/plans/archive/web-create-trip.md`）が、
作成しても **1 日目と出発チェックポイントしかできない**ため「作ったのに何も
変化が見えない」。iOS は作成直後に日数・宿泊地の候補（`trip_outline`）を出し、
採用すると日別プランと宿泊チェックポイントが生えるので、そこに揃える。

現状:

- サーバ側の生成は既にある: `lib/ai.ts` の `suggestTripOutline` /
  `parseTripOutlineInput`（`/api/ai/trip-outline` と `ai_jobs` の
  `kind = "trip_outline"` が使用）
- **採用処理は Swift にしか無い**（`PlanEditor.adopt(_ candidate:into:)`）。
  Web の `adoptPlanSuggestion` は行程提案（`kind = "plan"`）用で別物
- Web の作成フォームは作成後すぐ `/trips/<id>` へ遷移する
- 旅行画面の「AI で行程を提案」は出発地が空のまま（iOS は 1 日目の出発
  チェックポイント名を初期値に入れている）

## 対応方針

### 生成はジョブ方式（同期呼び出しにしない）

候補の生成は 1 分前後かかる。本番は Cloudflare 経由で 100 秒制限があるため、
iOS と同じ `ai_jobs` を使う:

1. `startTripOutlineAction` … `createAiJob({id: randomUUID(), kind: "trip_outline", input})`
   → `after(() => runAiJob(id))` で応答後に生成、id を返す
2. `pollTripOutlineAction(id)` … `getAiJob(id)` の status / result / error を返す
   （クライアントが 3 秒間隔でポーリング。`STALE_MINUTES` 超過は既存実装が failed に落とす）

`/api/ai/jobs` と同じ関数を呼ぶだけなので、API 仕様・スキーマの変更は無い。

### 採用処理（Swift `PlanEditor.adopt` の移植）

`lib/plan.ts` に `adoptTripOutline(tripId, candidate, destinationLatitude, destinationLongitude)`:

1. 開始日 = 既存の最初の日の `date` ?? 表示 TZ での `trips.departure_at`（無ければ今日）
2. そこから `candidate.dayCount` 日分の連続した日付を作り、既存の日は再利用・
   足りない分だけ `trip_days` を作る
3. `trips.destination` が空でなければ**最終日**に `destination` チェックポイント
   （概算座標付き。片方だけの座標は両方捨てる）
4. `nights[i]` を i 日目（0 始まり）に `lodging` チェックポイントとして追加。
   日数を超える分は捨てる。名前が空の泊は飛ばす
5. `sort_order` は日ごとに既存の `max + 1` から連番（最終日は「到着 → 宿泊」の順）
6. 既存行の `updated_at` は進めない（LWW で iOS 側の編集を潰さないため）

### UI

- `/trips/new` … 作成に成功したら、目的地が入力されている場合はその場で候補
  ステップに切り替える（iOS と同じ。旅行は作成済みなので「スキップ」で
  `/trips/<id>` へ）。候補は「2泊3日・泊: 松本 → 上高地」の要約 + 泊の一覧を出し、
  「この候補を採用」で `adoptTripOutlineAction` → 旅行画面へ
  - iOS にある候補ごとのミニ地図は入れない（maplibre の GL コンテキストを候補数
    ぶん張ることになるため。位置は採用後の旅行画面の地図で確認できる）
- 旅行画面の「AI で行程を提案」… 出発地の初期値を 1 日目の `departure`
  チェックポイント名から入れる（iOS の `AIPlanSuggestView` と同じ。到着予定地は
  空のまま = 自宅など終点を書く欄なので）

## 影響範囲

- スキーマ・`/api/*` の仕様変更なし（既存の `ai_jobs` と `suggestTripOutline` を
  Server Action から使うだけ）
- 採用で作られる行は iOS と同じ形なので、同期（LWW / tombstone）の扱いは変わらない
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 未設定なら候補ステップはエラー表示に
  なるだけで、旅行の作成自体は成功している（スキップして続けられる）

## テスト方針

- `web/test/plan.test.ts` に `adoptTripOutline` のケースを追加
  - 1 日目を再利用して `dayCount` 分の日ができる / 既存の日は作り直さない
  - 最終日に destination、n 泊目が n 日目に lodging として入る
  - 最終日の並び順（到着 → 宿泊）、既存チェックポイントの後ろに付く
  - 名前が空の泊・日数を超える泊は捨てる / 座標が片方だけなら両方捨てる
  - 既存行の `updated_at` を進めない
- `npm run lint` / `npm run build` / `npm test`
- 手動: dev サーバで作成 → 候補 → 採用まで（AI キーが要るので実キーで 1 回）
