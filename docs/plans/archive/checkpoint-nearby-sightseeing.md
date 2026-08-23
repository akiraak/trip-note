# プランの日毎の検索で「観光地」と入れると経路の近くの観光地が出る

## 目的・背景

チェックポイントの「検索して追加」は、具体的な地名(松本城)を知っていないと使えない。
旅行先の土地勘が無い段階では「この日の経路の近くにどんな観光地があるか」を知りたいので、
検索欄に**「観光地」と入れるだけで、その日の経路(前泊地 → 訪問順 CP)沿いの観光地が
情報付きで一覧される**ようにする。追加の操作は今のまま(一覧から選んで追加)で複雑にしない。

現状の材料:

- その日の経路 `[{ name, latitude?, longitude? }]` は iOS `Domain/DayRoute.swift` /
  Web `lib/day-route.ts` で組める([checkpoint-search-day-route](archive/checkpoint-search-day-route.md))
- iOS の検索は MapKit の自然言語検索(`MKLocalSearch`)に経路周辺の領域ヒント付き。
  「観光地」でも何かは返るが、何が返るかは Apple 任せで情報(種類・距離・説明)が無い
- Web の検索は Nominatim(ジオコーダ)なので「観光地」のようなカテゴリ語ではほぼヒットしない
- 外部 OSM サービスをサーバでプロキシする構成(Nominatim / OSRM: User-Agent・直列
  スロットル・キャッシュ)が `web/src/lib/{nominatim,routing}.ts` にある

## 方式の選択

| 方式 | 長所 | 短所 |
| --- | --- | --- |
| MapKit POI 検索(iOS のみ) | 実装が軽い・速い | Web で使えない。結果の種類・説明が乏しく、並び順を制御できない |
| **OSM Overpass API(サーバでプロキシ)** | iOS / Web で同じ結果。タグから種類(城・寺社・博物館…)・Wikipedia・公式サイトが取れる。`around:` で**経路(折れ線)から一定距離内**を直接検索できる。キー不要 | 外部依存が 1 つ増える(OSRM / Nominatim と同じ運用)。データ密度は地域次第 |
| AI 検索補助 | 既にある | 遅い(数十秒)・トークン消費・実在の保証が無い。「観光地」と打つたびに走らせるものではない |

**Overpass をサーバでプロキシし、iOS / Web 共通の API にする。** 理由: 両プラットフォームで
同じ結果になる、「情報」(種類・距離・Wikipedia)を付けられる、並び順(有名どころ優先)を
サーバで調整できる。iOS の自由語検索(地名)は従来どおり MapKit のまま。

## 対応方針

### 共通仕様

- **カテゴリ語の判定**: 検索欄の入力が「観光地」「観光」「観光スポット」「名所」のいずれか
  (trim 後の完全一致)なら「近くの観光地」検索、それ以外は従来の地名検索。判定表は
  1 箇所に置き(Web `lib/category-search.ts` / iOS `Domain/CategorySearch.swift`)、
  将来「カフェ」「宿」などを足せる形にするが、**今回は観光地のみ**
- **検索範囲**: その日の経路の座標あり地点を結んだ折れ線から **半径 15km**
  (Overpass の `around:R,lat1,lon1,lat2,lon2,...`。地点が 1 つなら円)。長距離の移動日
  でも「経路沿い」だけが対象になり、外接矩形より無駄が少ない
- **対象タグ**(1 箇所で定義し調整可能):
  `tourism`=attraction / museum / viewpoint / zoo / aquarium / theme_park / gallery、
  `historic`=castle / monument / memorial / ruins / archaeological_site、
  `amenity=place_of_worship` と `natural`=peak / waterfall / hot_spring は
  **`wikipedia` or `wikidata` タグがあるものだけ**(寺社・山は無数にあるため有名どころに絞る)
- **並び順**: `wikipedia` / `wikidata` タグあり(= 有名どころ)を先に、同順位は経路からの
  距離が近い順。最大 20 件
- **結果の情報**: 名前(`name:ja` → `name`)、種類ラベル(城 / 寺社 / 博物館 / 展望
  スポット / 自然 …)、座標、経路上の最寄り地点名と距離(「宿 A から 3.2km」)、
  Wikipedia URL(`wikipedia`=`ja:松本城` → `https://ja.wikipedia.org/wiki/松本城`)、
  公式サイト(`website`)。チェックポイント種別は一律 `sightseeing`
- 経路に座標が 1 つも無い日は検索できない旨を表示する(iOS は従来の MapKit 検索に
  フォールバック)

### Phase 1: サーバ `POST /api/places/nearby` + Server Action(Web)

- `web/src/lib/overpass.ts`: クエリ組み立て(`[out:json][timeout:15]`、`nwr`、
  `out center tags`)、応答パース(node は lat/lon、way/relation は `center`)、
  種類ラベル・Wikipedia URL の導出、経路最寄り距離の計算(`lib/geo.ts` の haversine)、
  並び替え。Nominatim と同じ運用規約: User-Agent、直列 + 最小間隔 1 秒、
  (カテゴリ + 経路座標を小数 3 桁で丸めたキー)で 24 時間キャッシュ。
  エンドポイントは env `OVERPASS_ENDPOINT`(既定 `https://overpass-api.de/api/interpreter`)
- リクエスト `{ "category": "sightseeing", "route": [...] }`(`route` は search-assist と
  同じ形。バリデーションは `lib/ai.ts` の `parseRouteInput` を共有モジュールへ出して再利用。
  座標ありが 0 件なら 400)。レスポンス `{ "places": [ { name, kind, kindLabel,
  latitude, longitude, distanceM, nearestRouteName, wikipediaUrl, website } ] }`
- API route(Bearer、`app/api/places/nearby/route.ts`)と Server Action
  `nearbyPlacesAction`(Access 配下、Bearer なし。既存の `searchPlacesAction` と同じ扱い)
- `docs/specs/server-api.md` に追記

### Phase 2: Web の検索欄に組み込む

- `PlaceSearch`: 入力がカテゴリ語なら `nearbyPlacesAction(category, route)` を呼び、
  結果は既存の一覧 UI に「種類 · 宿 A から 3.2km」+ Wikipedia リンクを添えて表示。
  「追加」は既存の `onSelect` に `guessedType: "sightseeing"` で流す(追加操作は不変)
- 経路に座標が無ければ「この日の経路に座標がないため近くの観光地を探せません」

### Phase 3: iOS の検索欄に組み込む

- `Models/NearbyPlaceRecords.swift`(リクエスト / 応答 DTO)、`Services/AIClient.swift`
  と同様の extension で `nearbyPlaces(category:route:)`
- `CheckpointSearchView.search()`: カテゴリ語 + 経路に座標あり → サーバ検索。結果行は
  名前 / 種類 / 最寄り地点からの距離、Wikipedia がある行は右端にリンクアイコン
  (`Link`)。選択は既存の `PlaceSelection`(type = sightseeing)。
  カテゴリ語でも経路に座標が無ければ従来の MapKit 検索
- AI 補助欄・MapKit の自由語検索は変更なし

### スコープ外(将来)

- カフェ / 食事 / 宿のカテゴリ検索(判定表とタグ定義を足すだけで対応できる構成にしておく)
- Wikipedia 要約(説明文)の表示。`wikipediaUrl` を返しておくので後から足せる
- 地図上への候補表示

## 影響範囲

- web: 新規 `lib/overpass.ts` / `lib/category-search.ts` / `app/api/places/nearby/route.ts`、
  `lib/ai.ts`(route パースの共有化)/ `app/trips/[id]/{actions.ts,place-search.tsx}` /
  `docs/specs/server-api.md` → **サーバデプロイあり**。env・compose の変更なし
  (`OVERPASS_ENDPOINT` は既定値ありの任意 env)。**コンテナの外向き通信先に
  `overpass-api.de` が増える** → `../g3plus-ops/docs/workflows/trip-note.md` と
  `../g3plus-ops/CLAUDE.md` の trip-note 項に追記する(OSRM 追加時と同じ)
- iOS: 新規 `Domain/CategorySearch.swift` / `Models/NearbyPlaceRecords.swift`、
  `Services/AIClient.swift`(または新規 `Services/PlacesClient.swift`)/
  `Views/CheckpointSearchView.swift`。`xcodegen generate` を再実行
- DB・同期: 変更なし

## リスク・留意点

- Overpass 公開サーバは負荷制限(同時 2 本・日あたり上限)がある。単一ユーザー + 直列
  スロットル + 24 時間キャッシュで十分だが、応答が遅い(数秒〜十数秒)ことはある。
  UI は検索中表示で待てるようにする。落ちているときはエラーを表示するだけ
- 欧州サーバへの接続は happy-eyeballs の試行タイムアウト引き上げ(プロセス全体)が
  既に効くので追加対応は不要
- OSM のデータ密度・タグ付けは地域差があり、「観光地だが出てこない」はあり得る。
  対象タグと有名どころ判定は 1 箇所で調整できるようにする

## テスト方針

- web(vitest、fetch モック): Overpass クエリ組み立て(around の座標列・半径・タグ)、
  応答パース(node / way center・名前フォールバック・Wikipedia URL)、並び替え
  (有名どころ優先 → 距離順・上限 20)、最寄り地点名と距離、キャッシュと throttle、
  カテゴリ語判定、API 入力検証(座標なし route は 400)
- iOS(unmanaged): カテゴリ語判定、DTO のエンコード / デコード、
  「経路に座標なし → MapKit フォールバック」の判定
- 手動: 松本泊 → 上高地の日に「観光地」で松本城・上高地周辺のスポットが距離付きで
  出て、選ぶと従来どおり追加される(iOS シミュレータ / Web)。経路に座標が無い日の表示
- `xcodebuild build` / `test`、`npm run lint` / `npm run build` / `npm test` の通過
