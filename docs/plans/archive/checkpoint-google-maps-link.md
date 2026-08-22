# チェックポイントなど座標があるところから Google Maps に転送できるようにする

## 目的・背景

チェックポイントには座標(緯度経度)が入っているが、アプリ内地図(iOS: MapKit /
Web: MapLibre)で見られるだけで、外部の地図アプリに渡す手段がない。実際の移動時は
ナビ・ストリートビュー・営業時間などを Google Maps で見たいので、座標がある場所から
ワンタップで Google Maps を開けるようにする。

現状の材料:

- 座標を持つ永続エンティティはチェックポイント(iOS `Entities.swift` の
  `CheckpointEntity.latitude/longitude: Double?`、Web `types.ts` の
  `Checkpoint.latitude/longitude: number | null`)。**座標未設定があり得る**が、
  UI には既に「座標未設定」(`TripDayDetailView`)・「位置未定」(`plan-section.tsx`)の
  分岐があり、リンクの出し分けに再利用できる
- Google Maps / Apple Maps への連携は現状ゼロ。iOS の外部 URL 利用は設定アプリへの
  `Link` 1 箇所のみ、Web は `target="_blank"` の `<a>` が 2 箇所のみ
- iOS の日詳細(`TripDayDetailView`)の CP 行タップは既に「編集シートを開く」に
  占有されている

## 対応方針

### URL 形式(iOS / Web 共通)

- 公式のクロスプラットフォーム URL(Google Maps URLs)を使う:
  `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`
- クエリは**座標のみ**(名前で検索すると同名の別地点に飛ぶ恐れがある)。
  小数 6 桁程度に丸めて生成する
- iOS はユニバーサルリンクとして扱われるため、Google Maps アプリがあればアプリ、
  無ければブラウザで開く。`comgooglemaps://` スキーム +
  `LSApplicationQueriesSchemes`(project.yml 変更)は**使わない**

### Phase 1: iOS

- `Domain/GoogleMapsLink.swift` を新規追加し、純関数
  `GoogleMapsLink.searchURL(latitude:longitude:) -> URL` を置く(テスト可能に)
- UI(座標がある CP のみ表示。開くのは `@Environment(\.openURL)`):
  - `TripDayDetailView` の `CheckpointRow` に contextMenu(長押し)で
    「Google Maps で開く」を追加。行タップの「編集」は現状維持
  - `CheckpointEditView` の「位置」セクション(小地図・座標表示の並び)に
    「Google Maps で開く」ボタンを追加
- 新規ファイル追加のため `xcodegen generate` を再実行する

### Phase 2: Web

- `web/src/lib/google-maps.ts` を新規追加し `googleMapsSearchUrl(lat, lng)` を置く
- `plan-section.tsx` の `CheckpointRow` の操作ボタン群に外部リンクを追加
  (座標ありのみ。`target="_blank" rel="noreferrer"`)
- `trip-map.tsx` の CP マーカーポップアップにも同リンクを追加

### スコープ外(将来タスク)

- 日ルート全体を Google Maps の経路
  (`dir/?api=1&origin=…&destination=…&waypoints=…`)で開く機能。日単位の順序付き
  座標列は `TripDayDetailView` の `dayRoute` に既にあるが、waypoints 上限(9 地点)の
  分割方針が必要なので別タスクにする
- Apple Maps 連携
- GPS 記録点(`PointRow`)・メディアからの転送

## 影響範囲

- iOS: 新規 `Domain/GoogleMapsLink.swift` / `Views/TripDayDetailView.swift` /
  `Views/CheckpointEditView.swift`。Info.plist(project.yml)変更なし
- Web: 新規 `src/lib/google-maps.ts` / `app/trips/[id]/plan-section.tsx` /
  `app/trips/[id]/trip-map.tsx` → 閲覧 UI の変更のため**サーバデプロイあり**
- DB・同期・API 仕様: 変更なし

## テスト方針

- iOS ユニットテスト(新規 `GoogleMapsLinkTests`): URL 生成(座標の丸め・負の座標・
  クエリ形式)。エンティティ不要の純関数テスト
- Web(vitest): `googleMapsSearchUrl` の URL 生成
- 手動:
  - シミュレータで日詳細の CP 長押し →「Google Maps で開く」→ Safari で該当座標が
    開く(アプリ未インストールのため)。座標なし CP にはメニュー項目が出ない
  - 編集画面の「位置」セクションのボタンからも開ける
  - Web で CP 行・地図ポップアップのリンク → 新規タブで Google Maps が開く
- `xcodebuild build` / `test`、`npm run lint` / `npm run build` の通過
