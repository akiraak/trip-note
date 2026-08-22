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
- タイルは OpenFreeMap のベクタタイル(Liberty スタイル、`tiles.openfreemap.org`)を使う
  - 登録・API キー不要で本番利用可。帰属表記はスタイル側に含まれる。
    選定経緯は docs/plans/archive/web-map-tiles-production.md
  - Phase 3 当初は OSM 公式ラスタタイルを暫定利用していたが、利用ポリシー上
    本番アクセスに不適のため差し替えた
- GeoJSON LineString + line レイヤで軌跡を描画し、開始(緑)/最新(赤)のマーカーを置く
- `fitBounds` で軌跡全体にフィットさせる(バウンディングボックスは `src/lib/geo.ts` に実装)
- 位置情報が 0 件の場合は地図を表示しない

## テスト方針

- ロジックの追加はバウンディングボックス計算程度のため、新規ユニットテストは追加しない
- iOS: `xcodebuild test` が引き続き全件パスすること + シミュレータビルド成功
- Web: `npm run lint` + `npm run build` 成功
- iOS の実データ確認は Supabase 不要(ローカル SwiftData で完結)のため、
  シミュレータの位置シミュレーションを使った UI テストで行う(下記)
- Web の実データ確認のみ Supabase セットアップ後の手動確認に含める

## iOS の実データ確認(UI テスト)

`TripNoteUITests` スキーム(`RecordingMapUITests`)で記録開始 → 移動 → 停止 → trip 詳細の
地図表示までを通しで確認し、スクリーンショットを xcresult に残す。
位置シミュレーションが前提のため通常の `xcodebuild test`(TripNote スキーム)には含めない。

```bash
cd ios
xcodegen generate
UDID=$(xcrun simctl list devices | grep "iPhone 17 Pro (" | grep -oE "[0-9A-F-]{36}" | head -1)
xcrun simctl boot "$UDID" || true
xcodebuild -project TripNote.xcodeproj -scheme TripNoteUITests -destination "id=$UDID" build-for-testing
xcrun simctl install "$UDID" <DerivedData 内の TripNote.app>
xcrun simctl privacy "$UDID" grant location-always com.akiraak.TripNote
xcrun simctl location "$UDID" start --speed=15 --distance=20 \
  35.681236,139.767125 35.684,139.774 35.677,139.772 35.675,139.763 35.681236,139.767125
xcodebuild -project TripNote.xcodeproj -scheme TripNoteUITests -destination "id=$UDID" \
  test-without-building -resultBundlePath <出力先>.xcresult
xcrun simctl location "$UDID" clear
```

確認済みスクリーンショット(2026-08-21): [docs/screenshots/phase3-ios-map-simulator.png](../screenshots/phase3-ios-map-simulator.png)
