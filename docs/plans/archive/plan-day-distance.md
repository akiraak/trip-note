# 旅行画面のプランの各日に車での走行距離を表示する

## 目的・背景

旅行画面のプラン一覧(`TripDetailView` の `TripDayRow`)には日毎のチェックポイント
概要とミニ地図はあるが、その日に車で何 km 走るのかが分からない。日毎の走行距離を
表示して、1 日の移動量を見て判断できるようにする。

現状の材料:

- ルートはサーバの `POST /api/route`(OSRM プロキシ)で「隣接チェックポイント間の
  レグ」単位に解決済みで、レスポンスは座標列に加えて `distanceM` / `durationS` を
  既に返している(`docs/specs/server-api.md`、`route_legs` テーブルにも保存済み)
- しかし iOS 側は `RouteClient.swift` の `roadPolylines(for:)` が座標列
  (`[RoutePoint]`)だけを返し、`distanceM` / `durationS` を捨てている。
  メモリキャッシュ `RouteLegCache` も座標列のみ保持
- つまり**サーバ変更なし、iOS のみのプラミング + 表示**で実装できる

## 対応方針(iOS のみ。データモデル・同期・API は変更なし)

### 1. レグ解決結果に距離・所要時間を通す

- `Models/RouteRecords.swift` の `RouteLegPolyline` はそのまま使い、アプリ内表現
  `ResolvedRouteLeg { points: [RoutePoint], distanceM: Double, durationS: Double }`
  を `Domain/RouteLegs.swift` に追加する
- `RouteLegCache` を `[String: ResolvedRouteLeg]` に変更し、
  `SyncClient.roadPolylines(for:)` を `resolvedLegs(for:) -> [ResolvedRouteLeg?]`
  に置き換える。既存の呼び出し(`TripDayMiniMap` / `TripMapView` / 日詳細)は
  `.points` を取るだけの変更
- `durationS` は本タスクでは未使用だが、日詳細の到着予想時刻タスク
  ([day-detail-editing](day-detail-editing.md) Phase 3)がここに乗るため一緒に通す

### 2. 日毎距離の合算を Domain の純関数に

- `RouteLegDistance.totalMeters(legs: [RouteLeg], resolved: [String: ResolvedRouteLeg]) -> Double`
  のような純関数を `Domain/` に追加する
  - 解決済みレグは `distanceM`、未解決レグは `Geo.haversineDistance` の直線距離で
    フォールバック(全滅でも直線合算の概算は出す)
  - `isDegenerate`(同一座標)レグは 0 扱い

### 3. `TripDayRow` に表示

- 現在はレグ解決を `TripDayMiniMap` 内の `.task(id: レグキー列)` で行っている。
  この解決 state を `TripDayRow` に持ち上げ、ミニ地図には解決結果を渡す構成に
  変更する(1 つの `.task` で地図と距離の両方を賄い、行あたりの二重リクエストを
  避ける)
- ヘッダ行(「N日目」+ 日付)の並びに `車 約123 km` のように表示する
  (`systemImage: "car"` + フォーマット。未解決レグ混じり・OSRM 由来のどちらでも
  概算なので常に「約」を付ける)。レグが 0 本の日(座標なし)は非表示
- フォーマットは `ContentView.formatDistance(_:)`(m / km 切り替え)を流用する

### 補足(スコープ外)

- 日詳細画面(`TripDayDetailView`)への距離表示・所要時間の表示は今回対象外
  (同じ部品でいつでも足せる。所要時間は day-detail-editing Phase 3 で扱う)
- Web のプラン距離表示も対象外(Web はプランルート描画自体が未実装の現状維持)

## 影響範囲

- iOS のみ: `Services/RouteClient.swift` / `Domain/RouteLegs.swift`(または新規
  `Domain/RouteLegDistance.swift`)/ `Views/TripDetailView.swift`
  (`TripDayRow` / `TripDayMiniMap`)/ `Views/TripMapView.swift` /
  `Views/TripDayDetailView.swift`(呼び出し名の追従)
- 新規ファイルを追加した場合は `xcodegen generate` を再実行する
- web: 変更なし(サーバデプロイ不要)

## リスク・留意点

- 未解決レグの直線フォールバックは実走行距離より短く出る。解決は既存の
  `.task(id:)` 機構で進むため、取得完了後に表示が自動更新される(「約」表記で吸収)
- List 行ごとの非同期解決という構成は既知の性能懸念のまま
  (`docs/plans/archive/plan-maps-in-trip-view.md`)。今回の変更は解決結果の
  持ち上げのみでリクエスト数は増やさない

## テスト方針

- iOS ユニットテスト(unmanaged エンティティ、既存 `RouteLegsTests` に追加):
  - 距離合算の純関数: 全レグ解決済み / 一部未解決(直線フォールバック混在)/
    全レグ未解決 / 0 レグ / degenerate レグ
  - `RouteLegPolyline` → `ResolvedRouteLeg` の変換(`distanceM` / `durationS` 保持)
- 手動(シミュレータ): プラン各日に距離が出る、ルート解決前後で値が更新される、
  サーバ停止時に直線概算へフォールバックする
- `xcodebuild build` / `test` の通過
