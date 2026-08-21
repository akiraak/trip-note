# Phase 3: 地図表示 詳細仕様

親プラン: [basic-features](../plans/basic-features.md)

## 目的

trip 詳細画面で移動経路を地図上に可視化する。iOS は MapKit、Web は MapLibre GL JS を使う。

## iOS (MapKit)

- `TripDetailView` の先頭に地図セクションを追加する(`Views/TripMapView.swift`)
- SwiftUI の `Map`(iOS 17+)+ `MapPolyline` で軌跡を描画する
  - 開始地点に緑のマーカー、最新(終了)地点に赤のマーカーを表示する
  - カメラは `.automatic` で全コンテンツにフィットさせる
- 個々の位置情報のドット表示は行わない(数千点になり得るため)。点の詳細は既存のタイムラインで確認する
- 位置情報が 0 件の trip では地図を表示しない

## Web (MapLibre GL JS)

- `maplibre-gl` を導入し、`/trips/[id]` のヘッダ下に地図を表示する(`src/app/trips/[id]/trip-map.tsx`、Client Component)
- タイルは当面 OpenStreetMap の公式ラスタタイル(`tile.openstreetmap.org`)を使う
  - API キー不要で開発に十分。ただし OSM のタイル利用ポリシー上、本番の大量アクセスには不適のため、
    本番運用時はタイルソースの差し替えを検討する(MapTiler / Protomaps 等)。後続タスクとして TODO に積む
- GeoJSON LineString + line レイヤで軌跡を描画し、開始(緑)/最新(赤)のマーカーを置く
- `fitBounds` で軌跡全体にフィットさせる(バウンディングボックスは `src/lib/geo.ts` に実装)
- 位置情報が 0 件の場合は地図を表示しない

## テスト方針

- ロジックの追加はバウンディングボックス計算程度のため、新規ユニットテストは追加しない
- iOS: `xcodebuild test` が引き続き全件パスすること + シミュレータビルド成功
- Web: `npm run lint` + `npm run build` 成功
- 実データでの見た目確認は Supabase セットアップ後の手動確認に含める
