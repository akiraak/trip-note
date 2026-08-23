# AI の日数・宿泊地候補にプレビュー地図を出す(Web)

## 目的・背景

Web の旅行作成の候補ステップ（`docs/plans/archive/web-trip-outline.md`）は
文字だけで、iOS の候補にはある**ミニ地図**が無い。「どこを回る候補なのか」が
地名の羅列だけでは分かりにくいので、iOS と同じく候補ごとに出発地・各泊・目的地を
並べた地図を出す。

iOS 側の該当実装:

- `TripCreateView.mapPoints(for:departure:destinationName:...)` … 出発地 →
  各泊 → 目的地の順に点を作る（座標が無い点は飛ばす）
- `OutlineCandidateMap` … マーカー + ポリラインの操作不可の地図（高さ 150）

## 対応方針

### 点の組み立て（純ロジック）

`web/src/lib/outline-map.ts` に `outlineMapPoints(...)` を置き、iOS の
`mapPoints` と同じ順序・同じ「座標が無い点は飛ばす」規則で点列を作る。
ユニットテストはここに書く（React コンポーネントのテスト基盤は無いため）。

- 出発地: 作成フォームで Google Maps のリンクから座標を取れたときだけ（手入力の
  名前だけなら座標が無いので出ない。iOS も同じ）
- 各泊: AI の概算座標（`nights[].latitude/longitude`。片方だけなら捨てる）
- 目的地: `suggestion.destinationLatitude/Longitude`（候補共通）

### 地図（`app/trips/new/outline-map.tsx`）

`trip-map.tsx` と同じ OpenFreeMap のスタイルと `setWorkerUrl` の作法で、
候補 1 件ぶんの小さな地図を描く。

- `interactive: false`（プレビューなので操作させない。iOS も `interactionModes: []`）
- `boundingBox`（`lib/geo.ts`）で全点が入る範囲に fit（`maxZoom` を控えめに）
- 点が 2 つ以上あればポリラインで順に結ぶ
- マーカーは `CHECKPOINT_COLORS` の色（出発 = 緑 / 宿泊 = インディゴ / 目的地 = 赤）、
  マーカー要素の `title` に「1泊目 松本市街」などのラベルを入れる
- 座標のある点が 1 つも無ければ地図を出さない（AI が座標を返さないことがある）

候補は通常 2〜3 件なので WebGL コンテキストも 2〜3 個。多すぎる場合に備えて
**地図を描くのは先頭 3 候補まで**とし、それ以降は文字だけにする。

## 影響範囲

- 追加のみ。既存の候補ステップの文言・採用処理・API は変えない
- 依存追加なし（maplibre-gl は導入済み。ワーカーの配置も `predev`/`prebuild` 済み）

## テスト方針

- `web/test/outline-map.test.ts` に `outlineMapPoints` のケース
  （順序、座標なしの除外、片方だけの座標、目的地名の既定値、泊のラベル）
- `npm run lint` / `npm run build` / `npm test`
- 手動: dev サーバで候補ステップに地図が出ること（AI キーが無いので候補 JSON は
  治具で差し込む）
