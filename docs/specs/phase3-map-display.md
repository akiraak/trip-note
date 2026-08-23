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

### プランルート(道路形状)

プランのルート(トップ地図の破線 / 日別ミニ地図・日詳細の実線)は、チェックポイントを
直線で結ぶのではなく実際の道路形状で描く。

- ルートは「隣接チェックポイント間のレグ(区間)」の集合として扱う
  (`Domain/RouteLegs.swift`)。座標なしのチェックポイントは従来どおり黙って飛ばし、
  丸め粒度(小数 4 桁 ≒ 10m)で同一地点になるレグは作らない
- 道路形状は `POST /api/route`(OSRM プロキシ、[server-api.md](server-api.md))から
  レグ単位で取得する(`Services/RouteClient.swift`)。アプリ内メモリキャッシュ →
  サーバの `route_legs` キャッシュの二段で、スクロールによる再表示では再リクエストしない
- **取得前・失敗時(サーバ未設定・OSRM 停止・ルート無し)はそのレグだけ従来の直線で描く**
  (表示は壊れない)。スタイルは従来どおりプラン = 破線 / 実績 = 実線
- 各 Map は `.task(id: レグキー列)` で解決するため、チェックポイントの途中挿入・
  並び替え・座標の具体化では変わった区間だけ再取得され、ルートが自動で追従する
- 旅行作成時の AI 候補プレビュー(`TripCreateView` の `OutlineCandidateMap`)は対象外
  (概算座標どうしの道路ルートは意味が薄く、候補は一時表示のため直線のまま)

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
- ソース/レイヤの追加は `load` ではなく **`style.load`** で行う。`load` は
  タイルが出そろうまで発火しないので、回線やタイルの状況次第でルートが遅れて出る

### プランルート(道路形状)

iOS と同じレグ(隣接チェックポイント間)単位で、プランのルートを道路形状で描く。

- **スタイルは iOS と同じ**: トップ地図(`trip-map.tsx`)のプランルートは**破線**
  (`#2563eb` / 幅 3 / opacity 0.55 / `line-dasharray [2,2]`)で、実績トラックの
  **実線**(幅 4)と区別する。日カードのミニ地図(`day-map.tsx`)は実線(幅 3)
- レグの組み立て・キー規約は `src/lib/route-legs.ts`(`legKey` / `buildLegs` /
  `totalLegMeters` / `legLines`)。iOS の `Domain/RouteLegs.swift` と同じ規約なので
  サーバの `route_legs` キャッシュを iOS と共有できる
- **ブラウザから `/api/route` は叩かない**。`/api/route` は `API_SHARED_SECRET` の
  Bearer が要る iOS 向けの契約で、閲覧 UI はそれを持たない。ページと同じ保護範囲
  (本番は Cloudflare Access)で動く Server Action(`route-actions.ts` の
  `resolveRouteLegsAction`)からサーバ内で `fetchRouteLegs()` を直接呼ぶ
- 解決は `use-route-legs.ts` が一手に引き受ける。モジュールスコープのキャッシュ +
  未解決キーを 8 件ずつ順に投げるキューで、地図の枚数だけリクエストが飛ばない
  (Next.js はクライアントごとに Server Action を直列にディスパッチするため)
- SSR 時点でキャッシュ済みのレグは `readCachedLegs()`(**DB 参照のみ・OSRM を呼ばない**)で
  初期値として渡すので、2 回目以降と iOS で先に見た旅行は最初の描画から道路形状になる
- **取得前・失敗時はそのレグだけ直線で描く**(iOS と同じ)。日カードの走行距離も
  解決済みは道路距離・未解決は直線距離の混在なので、表示は常に「約 N km」
- トップ地図のルート用座標列は `planDays` から**日付順 → 日内 `sort_order` 順**で組む
  (`checkpointMarkers` は trip 全体を `sort_order` で並べたもので日をまたぐ順序が保証されない)
- レグが解決しても地図は作り直さず、`getSource(...).setData(...)` でルートだけ差し替える

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
