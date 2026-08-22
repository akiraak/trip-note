# g3plus デプロイ契約

trip-note サーバ(`web/`)を g3plus(自宅サーバ)で動かすための契約。
デプロイ設定の正本は `g3plus-ops/trip-note/`(docker-compose.yml / Dockerfile / .env)。
運用手順は `g3plus-ops/docs/workflows/trip-note.md`。契約が変わったらそちらを追従させる。

## 契約

- **リポジトリ**: https://github.com/akiraak/trip-note (**public**)。g3plus 上に
  `/home/ubuntu/trip-note/` として clone し build context にする(デプロイ対象は `web/` のみ)
- **Node**: 24(better-sqlite3 のネイティブ ABI を Dockerfile の deps/runtime で一致させる)
- **ビルド**: `npm ci` → `next build`(`output: "standalone"`)。起動は `node server.js`
- **ポート**: 3011(コンテナ内。ホストへは**非公開**、Cloudflare Tunnel のみで到達)
- **必須 env**(`g3plus-ops/trip-note/.env`):
  - `API_SHARED_SECRET` — iOS の `/api/sync` を守る共有シークレット(`openssl rand -hex 32`)。
    iOS の `ServerConfig.plist` の API_KEY と揃える
  - `TRIPNOTE_DB_PATH=/app/data/trip-note.db`
- **任意 env**(AI 提案・検索補助 `/api/ai/*`。使うプロバイダの分だけ設定):
  - `ANTHROPIC_API_KEY` — Claude(Opus 5 / Sonnet 5)用
  - `OPENAI_API_KEY` — ChatGPT(GPT-5.6 Sol / Terra)用
  - 未設定でも他機能は動く(AI 呼び出し時にエラーメッセージを返すだけ)。
    モデル選択は Web の `/settings`(DB の `app_settings` に保存)
- **永続化**: SQLite + メディアファイル(`/app/data/media/`、`TRIPNOTE_DB_PATH` と同じ
  ディレクトリ配下なので env 追加は不要)。volume `/home/ubuntu/trip-note/web/data:/app/data`
- **注意**: メディアアップロードは Cloudflare Tunnel 経由のため 1 リクエスト 100MB が上限
  (無料プラン)。iOS 側は動画を 720p mp4 に圧縮して送る(docs/specs/phase4-media.md)
- **TZ**: America/Los_Angeles(g3plus 既定。Web の表示 TZ も同じ)

## Cloudflare(要 akiraak の手作業)

ホスト名: `trip.chobi.me`（2026-08-21 設定済み）

1. **Tunnel hostname**: `trip.chobi.me` → `http://trip-note:3011`
2. **Access(2 アプリケーション)**:
   - `trip.chobi.me/api` → ポリシー **Bypass**(Everyone)。API 自体が Bearer で認証する
   - `trip.chobi.me` → **Allow**(Google IdP / Emails)。閲覧 UI の唯一の認証
   - パスが具体的な方が優先されるため、`/api` の Bypass を先に効かせられる
3. トレードオフ: origin に直接届く相手(コンテナと同一 Docker ネットワーク)には閲覧 UI が
   無認証になる(ai-secretary の /admin と同じ整理。ホストポートは非公開にしてある)

## デプロイ後の疎通確認

```bash
# Bearer なし → 401 / あり → 200
curl -s -o /dev/null -w '%{http_code}\n' https://trip.chobi.me/api/sync -X POST -d '{}'
curl -s https://trip.chobi.me/api/sync -X POST \
  -H "Authorization: Bearer $API_SHARED_SECRET" -H 'Content-Type: application/json' -d '{}'
```
