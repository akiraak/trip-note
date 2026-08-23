# Web の日毎プランに地図を表示

## 目的・背景

Web の旅行詳細(`web/src/app/trips/[id]/plan-section.tsx`)の日カードはテキストだけで、
その日にどこをどう回るのかが分からない。位置関係が見えるのはページ上部の地図
(`trip-map.tsx`)1 枚だけで、そこには旅行の全チェックポイントが混在している。

iOS は同じ課題に対して日別ミニ地図(`TripDayMiniMap`)を入れてある
(`docs/plans/archive/plan-maps-in-trip-view.md`)。Web にも同等の地図を出し、
日ごとの回り方を見えるようにする。

## 対応方針(Web のみ。DB スキーマ・API・同期契約は変更なし)

ルート線は**この段階では直線**(訪問順に結ぶだけ)。道路形状のルートと日毎の距離表示は
別プラン(`docs/plans/web-plan-route.md`)で載せる。

### Step 1: 地図まわりの共通化

`MAP_STYLE_URL`(OpenFreeMap)と `setWorkerUrl("/maplibre-gl-worker.mjs")` が
`trip-map.tsx` と `trips/new/outline-map.tsx` に重複しているので、
`src/lib/maplibre-setup.ts` に切り出して 3 箇所目(日別地図)から使う。

- モジュール読み込み時に `setWorkerUrl` を呼び、`MAP_STYLE_URL` を export する
- クライアントコンポーネントからのみ import する(server component から触らない)

### Step 2: 日別地図コンポーネント `src/app/trips/[id]/day-map.tsx`(新規)

- props: `points`(その日の座標ありチェックポイントを訪問順に。id / type / name / 座標)、
  `anchor`(前泊地などルートの起点 | null)
- 表示:
  - 種別色(`CHECKPOINT_COLORS`)のマーカー `scale: 0.7`。ラベルはユーザー入力なので
    `outline-map.tsx` と同じく element の `title` に `種別: 名前` を入れる
  - 訪問順に結ぶポリライン(`#2563eb` 幅 3、round cap/join)
  - `anchor` は小さい灰色の丸(iOS のミニ地図と同じ控えめな表示)で、線の起点にする
- `bounds` は anchor 込みで `boundingBox`(`lib/geo.ts`)、`fitBoundsOptions: { padding: 32, maxZoom: 15 }`
- `interactive: false`(`outline-map.tsx` と同様)。ページ内に複数並ぶ地図がスクロールや
  ピンチを奪わないようにするため。将来ズームさせたくなったら `cooperativeGestures` を検討する
  (maplibre-gl v6 にオプションあり)
- 高さは `h-40`(160px)相当、`rounded-md` + 枠線(ダークモードは既存カードに合わせる)

### Step 3: 表示データの純関数化 `src/lib/plan-map.ts`(新規・テスト対象)

- `dayMapPoints(days)`: `PlanDay[]` → 日ごとの `{ points, anchor }`
  - `points`: 緯度・経度が両方そろっているチェックポイントだけを日内の順序のまま残す
  - `anchor`: iOS の `DayRoute.anchor(before:in:)` の移植。**その日より前の日を逆順に見て、
    最初に見つかった座標ありチェックポイント(= 前泊地)**。無ければ null
- 座標が片方だけ・null のものは黙って飛ばす(現状の iOS / Web の描画と同じ規則)

### Step 4: 日カードへの組み込みと遅延マウント

- `DayCard` のチェックポイント一覧の下に地図を置く。座標ありが 0 件の日は地図を出さない
- **WebGL コンテキスト数対策**: 地図 1 枚につき canvas / GL コンテキストを 1 つ使い、
  ブラウザの上限(概ね 16)を超えると古い地図が白く抜ける。候補地図で先頭 3 件までに
  制限したのと同じ問題(`docs/plans/archive/web-outline-candidate-map.md`)。
  日数は旅行によっては 10 日を超えるので、`IntersectionObserver` で
  **可視になったらマウント / 1 画面分以上離れたらアンマウント**する
  - 未マウント時は同じ高さのプレースホルダ(枠のみ)を出してレイアウトを揺らさない
  - フックは `src/app/trips/[id]/use-lazy-mount.ts` に切り出す(候補地図など他所からも使える形)

## 影響範囲

- web(新規): `src/lib/maplibre-setup.ts` / `src/lib/plan-map.ts` /
  `src/app/trips/[id]/day-map.tsx` / `src/app/trips/[id]/use-lazy-mount.ts`
- web(変更): `plan-section.tsx`(日カードに地図)/ `trip-map.tsx` /
  `trips/new/outline-map.tsx`(共通化の差し替えのみ)
- DB スキーマ・`/api/*`・同期契約・iOS: 変更なし
- デプロイ: 通常の rebuild のみ(env・compose の変更なし)

## テスト方針

- vitest: `plan-map.ts` の純関数
  - 前泊地の探索(直前の日から取る / 数日前まで遡る / 見つからなければ null)
  - 座標なし・片方だけの座標のチェックポイントを除外すること
  - 日内の順序が保たれること、tombstone は呼び出し側で除外済みの前提を崩さないこと
- `npm run lint` / `npm run build`
- 手動(`npm run dev`): 複数日の旅行で各日の地図が出ること、前泊地の点から線が始まること、
  座標ゼロの日に地図が出ないこと、日数の多い旅行をスクロールしても地図が白くならないこと、
  ダークモードでの見た目

## スコープ外

- 道路形状のルート線・日毎の走行距離表示 → `docs/plans/web-plan-route.md`
- トップ地図の「今日以降だけ表示」絞り込み(iOS のみの挙動。Web は全件表示のまま)
- 日詳細ページ(Web には無い。プランは旅行詳細に一体で表示している)
