# DONE - 完了済みタスク

## 2026-08-21

- バックエンドを Supabase から自宅サーバ (g3plus) に入れ替える [plan](docs/plans/archive/g3plus-backend.md)
  - Web: Next.js が API（`/api/sync`、`API_SHARED_SECRET` の Bearer）と閲覧 UI を兼ねる構成に変更。DB は SQLite（better-sqlite3）。アプリ内認証・/login・proxy.ts を撤去
  - iOS: supabase-swift を撤去し `SyncClient` + `ServerConfig.plist` に置き換え（needsSync キュー・500 件バッチ・upsert 冪等は維持）
  - ローカル E2E（シミュレータで記録 → 停止時自動同期 → Web の一覧・詳細・地図表示）で検証。maplibre-gl が Turbopack 下でワーカーを解決できないバグも発見・修正
  - 本番デプロイ（g3plus、port 3011・ホスト非公開）+ Cloudflare 設定（`trip.chobi.me`。Access: ルート Google 認証 + `/api` Bypass）+ 本番疎通確認（Bearer 401/200・閲覧 UI が Access 302）+ iOS の ServerConfig.plist 本番切替まで完了
