# DONE - 完了済みタスク

## 2026-08-21

- 基本機能を詰める [plan](docs/plans/archive/basic-features.md)
  - Phase 0: 技術選定・スキャフォールド（ネイティブ構成: iOS Swift/SwiftUI + Next.js。バックエンドは Supabase で開始し途中で自宅サーバ g3plus に全面移行）
  - Phase 1: 位置情報の記録（画面 OFF・バックグラウンド対応、SwiftData ローカル保存）
  - Phase 2: 同期と記録の閲覧（needsSync キューで trips → points をアップロード） [spec](docs/specs/server-api.md)
  - Phase 3: 地図表示（iOS: MapKit / Web: MapLibre GL JS） [spec](docs/specs/phase3-map-display.md)
  - Phase 4: 写真撮影と動画撮影 [spec](docs/specs/phase4-media.md) — カメラ撮影 + ライブラリ取り込み、写真 JPEG 2560px / 動画 H.264 mp4 720p に圧縮、撮影時刻に最も近い記録点へ紐付け、`POST /api/media` で同期、iOS / Web の詳細画面グリッド + 地図サムネイルマーカーで閲覧
    - 検証: iOS ユニットテスト 24 件・Web lint/build・API curl 全ケース・シミュレータ E2E、本番デプロイ + 疎通確認、実機で写真・動画を撮影 → 本番同期 → 保存（jpg 1920x2560 / mp4 3.4MB）・配信（Range 206）・ページ表示まで確認

- 実機で本番同期を動作確認
  - iPhone 14 Pro で記録（4 地点・31m）→ 停止時の自動同期で本番サーバに反映されることを確認。サーバ側 DB の値（4 点・総距離 31.3m・精度 ±2〜5m）がアプリ表示と一致

- バックエンドを Supabase から自宅サーバ (g3plus) に入れ替える [plan](docs/plans/archive/g3plus-backend.md)
  - Web: Next.js が API（`/api/sync`、`API_SHARED_SECRET` の Bearer）と閲覧 UI を兼ねる構成に変更。DB は SQLite（better-sqlite3）。アプリ内認証・/login・proxy.ts を撤去
  - iOS: supabase-swift を撤去し `SyncClient` + `ServerConfig.plist` に置き換え（needsSync キュー・500 件バッチ・upsert 冪等は維持）
  - ローカル E2E（シミュレータで記録 → 停止時自動同期 → Web の一覧・詳細・地図表示）で検証。maplibre-gl が Turbopack 下でワーカーを解決できないバグも発見・修正
  - 本番デプロイ（g3plus、port 3011・ホスト非公開）+ Cloudflare 設定（`trip.chobi.me`。Access: ルート Google 認証 + `/api` Bypass）+ 本番疎通確認（Bearer 401/200・閲覧 UI が Access 302）+ iOS の ServerConfig.plist 本番切替まで完了
