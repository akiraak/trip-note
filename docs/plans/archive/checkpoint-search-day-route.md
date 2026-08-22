# チェックポイント検索にその日の経路を渡す

## 目的・背景

日詳細の「検索して追加」(および CP 編集の「検索して位置を設定」)は、検索範囲の
ヒントが**旅行全体の座標の平均を中心にした 100km 四方**(iOS `CheckpointSearchView.regionHint`)
で、Web(Nominatim)は位置の考慮なしの全世界検索。AI 検索補助も「地域」を毎回
手入力する必要があり、その日どこからどこへ動くかを知らない。

長距離旅行(シアトル → シカゴなど)では平均点が行程の中間になり、今日の行程と無関係な
場所が優先される。**その日の経路**(前泊地 → その日の訪問順チェックポイント)を
検索に渡し、「今日の行程沿い」で探せるようにする。

現状の材料:

- iOS 日詳細は `dayRoute`(前泊地 `TripDetailView.routeAnchor` + 座標あり CP)を
  地図・到着予想用に既に組んでいる。座標だけで名前は持っていない
- Web は `PlanSection` が全日の `days` を持つので前日の最後の座標あり CP を辿れる
- Nominatim は `viewbox`(`bounded=1` なしなら優先度バイアスのみ)を受け付ける
- AI 補助の入力は `area`(必須)/ `type` / `request` のみ(`docs/specs/server-api.md`)

## 対応方針

「その日の経路」は iOS / Web 共通で `[{ name, latitude?, longitude? }]`
(前泊地 + その日の訪問順 CP。座標なし CP も名前だけ含める)とする。

### Phase 1: 地図検索の範囲をその日の経路に

- iOS: `Domain/DayRoute.swift` を新設
  - `DayRoutePlace`(name / latitude? / longitude?、Encodable)
  - `DayRoute.anchor(before:in:)`(前日までの最後の座標あり CP。
    `TripDetailView.routeAnchor` はこれに委譲)/ `DayRoute.places(for: day)`
  - `DayRoute.searchRegion(for:)`: 座標ありの点の外接矩形の中心 + 一辺
    = max(外接矩形の幅・高さ × 1.5, 20km) の正方形領域。座標が 1 つも無ければ nil
  - `CheckpointSearchView` に `route: [DayRoutePlace]` を渡し、領域は
    経路由来を優先、無ければ従来の旅行全体ヒントにフォールバック。
    呼び出し元(日詳細・CP 編集)は `DayRoute.places(for: day)` を渡す
- Web: `lib/day-route.ts` を新設(`dayRoute(days, index)` / `searchViewbox(places)`
  = 外接矩形を各辺 max(0.1°, 20%) 広げた `[minLon, minLat, maxLon, maxLat]`)。
  `searchPlaces(query, viewbox?)` が Nominatim に `viewbox` を付ける(`bounded` は
  付けない = 優先度のみ。キャッシュキーにも含める)。`PlaceSearch` / `CheckpointForm` /
  `SearchAssist` に `route` prop を通し、`DayCard` が `dayRoute(days, index)` を渡す

### Phase 2: AI 検索補助にその日の経路を渡す

- API `POST /api/ai/search-assist` に任意の `route`(上記配列、最大 30 件。name 必須、
  座標は両方 number か両方 null)を追加。**`route` が非空なら `area` を省略可**
  (AI が経路から地域を読む。従来どおり `area` を書けば併用)
- プロンプト: 「この日の経路(順に)」を名前 + 座標で列挙し、経路沿い・経路から
  大きく外れない地点を優先、既に経路にある地点は候補に出さない、と指示
- iOS: `AISearchAssistRequest.route`。検索画面の AI 欄は経路があれば地域未入力でも
  「候補をもらう」を押せる(プレースホルダで「経路から推定」を案内)
- Web: `SearchAssistInput.route` + `SearchAssist` の同じ挙動
- `docs/specs/server-api.md` を更新 → **サーバデプロイあり**

### スコープ外

- 現在地(CLLocationManager / ブラウザ Geolocation)の利用
- `/api/ai/plan`(行程提案)側への経路受け渡し

## 影響範囲

- iOS: 新規 `Domain/DayRoute.swift` / `Views/CheckpointSearchView.swift` /
  `Views/TripDayDetailView.swift` / `Views/CheckpointEditView.swift` /
  `Views/TripDetailView.swift`(routeAnchor の委譲)/ `Models/AIRecords.swift`。
  新規ファイルのため `xcodegen generate` を再実行
- Web: 新規 `lib/day-route.ts` / `lib/nominatim.ts` / `lib/ai.ts`(入力・プロンプト)/
  `app/trips/[id]/{actions,plan-section,place-search,checkpoint-form,search-assist}.tsx` /
  `docs/specs/server-api.md`
- 互換: `route` は任意なので旧 iOS クライアントはそのまま動く。DB・同期: 変更なし

## テスト方針

- iOS(unmanaged エンティティ、新規 `DayRouteTests` + `AIRecordsTests` 追加):
  前泊地の決定(前日 / 2 日前 / 無し)、座標なし CP を名前だけ含む、
  searchRegion の最小 20km・拡大率・座標なしで nil、リクエストのエンコード
- Web(vitest): `day-route.test.ts`(dayRoute / searchViewbox)、`ai.test.ts`
  (route のバリデーション・area 省略可・プロンプトに経路が入る)、
  nominatim の viewbox パラメータ(fetch モック)
- 手動: シミュレータで 2 日目の検索が 1 日目の宿泊地周辺に寄る、AI 欄が地域未入力で
  動く。Web で同様
- `xcodebuild build` / `test`、`npm run lint` / `npm run build` / `npm test` の通過
