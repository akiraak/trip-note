# バックエンドを Supabase から自宅サーバ (g3plus) に入れ替える

## 目的・背景

Supabase(クラウド BaaS)前提だったバックエンドを、自宅サーバ g3plus(`g3plus-ops` リポジトリで
構成管理。Docker + Cloudflare Tunnel)で動かす構成に全面的に入れ替える。
Supabase アカウント・外部サービス依存を無くし、既存の house 規約(ai-secretary / kitchen-living と同方式)に揃える。

## 新アーキテクチャ

- **サーバ = `web/` の Next.js が API と閲覧 UI を兼ねる**(1 コンテナ)。DB は SQLite(better-sqlite3、volume 永続化)
- **iOS → サーバ**: REST `POST /api/sync`。認証は `API_SHARED_SECRET` の Bearer(ai-secretary と同方式)。
  `needsSync` フラグによるアップロードキュー・500 件バッチ・upsert 冪等の設計は維持
- **Web 閲覧**: Next.js の Server Component が SQLite を直接読む。アプリ内認証は持たず、
  本番は前段の Cloudflare Access(Google IdP)で保護する。`/api/*` は Access を Bypass し Bearer で守る
- **ユーザーモデル**: 単一ユーザー(共有プール)。user_id・ログイン画面・auth テーブルは持たない。
  マルチユーザー化は将来必要になったら検討
- **iOS 接続設定**: `Resources/ServerConfig.plist`(SERVER_URL / API_KEY、gitignore)。Supabase.plist の置き換え
- **メディア(Phase 4)**: ファイルは volume 配下(`data/media/`)に保存。DB にメタデータ
- **タイムゾーン表示**: g3plus 既定に合わせ America/Los_Angeles に変更(旧実装は Asia/Tokyo 固定だった)

## 撤去するもの

- iOS: supabase-swift(SPM)、`SupabaseService`、`AuthView`、`Supabase.example.plist`
- Web: `@supabase/supabase-js`、`@supabase/ssr`、`lib/supabase/`、`app/login/`、`proxy.ts`(認証リダイレクト不要)
- `supabase/` ディレクトリ(migrations・README)。スキーマの正は `web/src/lib/db.ts` のマイグレーションに移す
- docs: `phase2-supabase-sync.md` に superseded 注記

## 追加するもの

- `web/src/lib/db.ts`: better-sqlite3 + `PRAGMA user_version` によるマイグレーション(trips / location_points / media)
- `web/src/app/api/sync/route.ts`: Bearer 認証 + trips/points の upsert
- iOS `Services/SyncClient.swift`: URLSession ベースの同期クライアント
- iOS ATS 例外(`NSAllowsLocalNetworking`): ローカル開発で Mac 上の dev サーバ(http)に繋ぐため
- `docs/specs/server-api.md`(API 契約)、`docs/specs/deploy-g3plus.md`(デプロイ契約)
- `g3plus-ops/trip-note/`: docker-compose.yml / Dockerfile / .env.example(port 3011、n8n_default、SQLite volume)
- `g3plus-ops/docs/workflows/trip-note.md`: 運用手順

## 影響範囲

- iOS の同期まわり(`SyncEngine` は SyncClient 呼び出しに変更。DTO の `TripRecord` / `LocationPointRecord` は流用)
- Web のデータ取得(supabase-js → SQLite 直接)とページ(`/login` 削除、`/` と `/trips/[id]` はクエリ層のみ差し替え)
- 認証 UI が全て消える(iOS の AuthView / Web の login ページ)
- デプロイ: trip-note は public リポジトリのため g3plus 上に clone してビルド(ai-secretary と同方式)

## テスト方針

- iOS: 既存ユニットテスト維持(DTO エンコードは実際に SyncClient が使うエンコーダで検証)+ `xcodebuild test`
- Web: `npm run lint` + `npm run build`
- ローカル E2E: dev サーバ(`API_SHARED_SECRET` 設定)+ curl で `/api/sync` を検証 →
  シミュレータの UI テスト(位置シミュレーション)で記録 → 自動同期 → Web の一覧/詳細/地図表示をブラウザで確認
- 本番デプロイと Cloudflare 設定(Tunnel hostname + Access)は要ユーザー操作のため手順書化して引き渡す

## Phase 構成

- Phase A: Web バックエンド(SQLite + /api/sync + ページ差し替え + Supabase 撤去)
- Phase B: iOS(SyncClient + 設定 + Supabase 撤去)
- Phase C: ローカル E2E 検証
- Phase D: デプロイ準備(g3plus-ops 側ファイル + 手順書。実デプロイは別途)
