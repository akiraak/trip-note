# 日毎プランのルートを実際の道路形状で表示する

## 目的・背景

日毎プランの地図はチェックポイント間を直線(`MapPolyline(coordinates:)`)で
結んでいるだけで、車でどの道を走るのかが分からない。実際の道路に沿った
ルート形状(ポリライン)を表示して、走る道の詳細が分かるようにする。

現状の直線描画箇所(iOS):

- 日別ミニ地図: `TripDetailView.swift` の `TripDayMiniMap`(前泊地起点 + 日内の
  チェックポイント列。`routeAnchor(before:in:)` で前泊地を求める)
- 旅行トップ地図の破線プランルート: `TripMapView.swift` `planRoute`
  (今日以降の全チェックポイントをフラット化した座標列)
- 日詳細画面(`TripDayDetailView.swift`)は現状ピンのみで線なし
- 旅行作成時の AI 候補プレビュー(`TripCreateView.swift` `OutlineCandidateMap`)も直線

Web はプランのルート線自体が未実装(実績トラックのみ。`trip-map.tsx`)。
ルーティング API(MKDirections / OSRM 等)はリポジトリのどこにも未使用。

## 対応方針

**サーバに共通ルーティング API を新設し(OSRM プロキシ + レグ単位キャッシュ)、
iOS はそこから道路ポリラインを取得して描画する。** 取得前・失敗時は従来の
直線にフォールバックする。

### 要件: 後からのチェックポイント追加・並び替えに追従する

途中に寄りたい観光名所を後から追加する(追加 → 並び替えで途中に挿入。
iOS は `TripDayDetailView` のドラッグ並び替え、Web は上下移動ボタンで既に可能)
ユースケースを一級で扱う。ルートを「日単位の 1 本」ではなく
**隣接チェックポイント間のレグ(区間)の集合**として扱うことで自然に対応する:

- 例: A→B の途中に C を挿入 → レグ列が A→C, C→B に変わる。新しい 2 レグだけ
  取得すればよく、その前後の変わらないレグ(X→A, B→Y など)はキャッシュがそのまま効く
- キャッシュキーは座標ペア(チェックポイント id ではない)なので、並び替え・削除・
  座標の具体化(検索で上書き)でも「変わった区間だけ再取得」になる
- iOS の表示はレグキー列を `.task(id:)` の id にして、編集後の再表示で自動的に
  差分解決する(未取得レグだけ直線 → 順次道路ポリラインへ)

サーバ集約にする理由:

- Web(MapLibre)では MKDirections が使えないため、iOS だけ MKDirections にすると
  将来 Web にルート線を足すとき形状も実装も食い違う。サーバ 1 箇所なら両者で同一形状
- レグ単位のキャッシュを iOS / Web で共有でき、外部 API の呼び出し回数を最小化できる
  (道路形状は滅多に変わらないので長期キャッシュでよい)
- Nominatim プロキシ(`web/src/lib/nominatim.ts` の throttle + キャッシュ +
  サーバ経由)と同じ構成パターンに載る。AI をサーバに集約したのと同じ整理

ルーティングエンジンは **OSRM 公式デモサーバ(router.project-osrm.org、
car プロファイル)** を使う。キー不要・追加 env 不要で、単一ユーザー +
サーバキャッシュ前提なら呼び出し量は僅少(1 旅行あたり高々数十レグ、初回のみ)。
エンドポイントは env(`OSRM_ENDPOINT`、任意・既定はデモサーバ)で差し替え可能にし、
将来 self-host や OpenRouteService へ移行できる口を残す。

### Phase 1: サーバ(web/)

1. **マイグレーション: `route_legs` テーブル**(サーバ専用・同期対象外。
   `app_settings` / `ai_jobs` と同じ扱いで sync 契約に波及しない)

   ```sql
   create table route_legs (
     key text primary key,        -- "lat,lon>lat,lon"(小数 4 桁丸め。約 10m 粒度)
     geometry text not null,      -- GeoJSON LineString の座標列 [[lon,lat],...] JSON
     distance_m real not null,
     duration_s real not null,
     created_at / updated_at      -- 既存テーブルと同じ default
   );
   ```

   - チェックポイント座標が変わればキーが変わるので明示的な無効化は不要
   - 肥大化対策: 追加時に上限(例 5000 行)を超えた分を古い順に削除

2. **`web/src/lib/routing.ts`(新規)**
   - `fetchRouteLegs(legs: {from, to}[])`: レグごとにキャッシュを引き、ミスだけ
     OSRM `GET /route/v1/driving/{lon},{lat};{lon},{lat}?overview=full&geometries=geojson`
     を呼んで保存。throttle(直列 + 最小間隔 1 秒)は nominatim.ts の
     `throttled()` と同方式
   - OSRM 失敗(タイムアウト・ルート無し)はそのレグを `null` で返し、
     **失敗はキャッシュしない**(次回再試行)
   - User-Agent は nominatim と同じ規約(`trip-note/0.1 (https://trip.chobi.me)`)

3. **`POST /api/route`(新規、Bearer)**
   - リクエスト: `{"legs":[{"from":{"latitude","longitude"},"to":{...}}, ...]}`
     (1 リクエストで複数レグをまとめて解決。上限例 50 レグ)
   - レスポンス: `{"legs":[{"coordinates":[[lon,lat],...],"distanceM":..,"durationS":..} | null, ...]}`
     (入力と同順・同数。解決できないレグは null = クライアントは直線フォールバック)
   - バリデーション: 座標範囲チェック、レグ数上限、400/401 は既存ルートと同じ規約

### Phase 2: iOS

4. **`Services/RouteClient.swift`(新規、SyncClient extension)+ DTO**
   - `fetchRouteLegs(_ legs: [(from, to)]) async throws -> [RouteLegPolyline?]`
   - アプリ内メモリキャッシュ(レグキー → 座標列。actor か NSCache)を挟み、
     スクロールによる再表示で再リクエストしない(サーバキャッシュと二段)

5. **レグ組み立ての純関数化(テスト対象)**
   - 「座標のあるチェックポイント列(+前泊地起点)→ レグ列」を `Domain/` の
     純関数に切り出す。座標 nil のチェックポイントは現状と同じく黙って飛ばす
   - 同一座標間(距離ほぼ 0)のレグはリクエストしない

6. **表示の差し替え(取得前・失敗時は現状の直線のまま)**
   - `TripDayMiniMap`: `@State` + `.task(id: レグキー列)` で非同期取得し、
     取得済みレグは道路ポリライン、未取得・失敗レグは直線で描く
   - トップ地図の `planRoute`: 同様にレグ列を非同期解決(破線スタイルは維持。
     プラン = 破線 / 実績 = 実線の描き分けを変えない)
   - `TripDayDetailView`(現状線なし): 日別ミニ地図と同じルート表示を追加
   - **AI 候補プレビュー(`TripCreateView`)は対象外**(概算座標どうしの道路
     ルートは意味が薄く、候補は一時表示のため。直線のまま)

### Phase 3: 仕様書・検証

7. `docs/specs/server-api.md` に `/api/route` の節を追加、
   `docs/specs/phase3-map-display.md` にプランルート(道路形状・フォールバック)を追記
8. Web のプランルート描画は今回のスコープ外(Web は実績トラックのみの現状維持。
   `/api/route` を使えばいつでも足せる状態にしておく)

## 影響範囲

- web: `src/lib/db.ts`(マイグレーション追加)/ `src/lib/routing.ts`(新規)/
  `src/app/api/route/route.ts`(新規)。既存ルート・同期契約・閲覧 UI は不変
- iOS: `Services/RouteClient.swift`(新規)/ `Models/`(DTO 追加)/
  `Domain/`(レグ組み立て)/ `TripDetailView.swift` / `TripMapView.swift` /
  `TripDayDetailView.swift`。新規ファイル追加後は `xcodegen generate` が必要
- デプロイ: env・compose の変更なし(`OSRM_ENDPOINT` は既定値ありの任意 env)。
  外部通信先に router.project-osrm.org が増える(サーバのみ。iOS からは自前 API 経由)

## リスク・留意点

- OSRM デモサーバは商用保証なし。落ちている間は直線フォールバックで表示は壊れない。
  呼び出しはキャッシュミス時のみで量は僅少だが、恒常利用が気になれば
  `OSRM_ENDPOINT` を self-host(g3plus)や他サービスに差し替える
- 日別ミニ地図は List 行ごとに Map を並べる構成で性能懸念が既知
  (`docs/plans/archive/plan-maps-in-trip-view.md`)。ルート取得はレグ単位
  キャッシュ + まとめ呼びで行ごとの重複リクエストを避ける
- 検討した代替案: iOS を MKDirections にする(追加依存ゼロだが Web と形状・実装が
  分岐し、結果の永続キャッシュは Apple の規約上グレーなため不採用)/
  OSRM を g3plus に self-host(日本の地図データで数 GB のメモリ・運用が重く、
  デモサーバ + フォールバックで足りるため見送り)

## テスト方針

- web(vitest): `routing.ts` を OSRM モックで検証 — キャッシュのヒット/ミス、
  座標丸めキー、失敗レグの null 返しと非キャッシュ、上限掃除。
  `/api/route` の入力バリデーション
- iOS(xcodebuild test): レグ組み立ての純関数(nil 除外・前泊地起点・
  同一座標スキップ、**途中挿入・並び替えでレグ列が正しく差し替わること**)と
  DTO のユニットテスト。地図表示はシミュレータで手動確認
  (直線 → 道路ポリラインへの差し替え、OSRM 停止時の直線フォールバック、
  **チェックポイントを途中に追加してルートが経由するよう更新されること**)
- `npm run lint` / `npm run build` / iOS ビルドの通過
