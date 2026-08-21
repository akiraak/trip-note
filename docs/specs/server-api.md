# サーバ API 仕様

サーバは `web/` の Next.js が兼ねる(閲覧 UI と同一プロセス)。DB は SQLite で、
スキーマの正は `web/src/lib/db.ts` の `MIGRATIONS`(trips / location_points / media)。

## 認証

- `/api/*`: `Authorization: Bearer <API_SHARED_SECRET>` 必須(env `API_SHARED_SECRET` と定数時間比較)
- 閲覧ページ(`/`, `/trips/[id]`): アプリ内認証なし。本番は前段の Cloudflare Access(Google IdP)で保護する
- 単一ユーザー(共有プール)。user_id は持たない

## POST /api/sync

iOS アプリからのアップロード。upsert で冪等(id はクライアント発行の UUID)。

リクエスト:

```json
{
  "trips": [
    { "id": "uuid", "title": "…", "started_at": "ISO8601", "ended_at": "ISO8601|null" }
  ],
  "points": [
    { "id": "uuid", "trip_id": "uuid", "latitude": 0, "longitude": 0,
      "altitude": 0, "accuracy": 0, "recorded_at": "ISO8601" }
  ]
}
```

- trips: `ON CONFLICT(id) DO UPDATE`(title / started_at / ended_at を更新、updated_at 更新)
- points: 不変のため `INSERT OR IGNORE`。存在しない trip_id を参照する点は FK 違反で全体を
  失敗させず、スキップして `skippedPoints` で返す
- どちらのキーも省略可(iOS は trips だけ → points 500 件ずつの順で送る)

レスポンス:

- `200 {"ok":true,"trips":N,"points":M,"skippedPoints":K}`
- `401 {"error":"unauthorized"}` / `400 {"error":"invalid json"|"invalid payload"}`

## クライアント(iOS)

- `Services/SyncClient.swift`。日付は ISO8601(小数秒付き)、DTO は `Models/SyncRecords.swift`
  (snake_case、nil カラムも明示的に null を送る)
- 接続設定は `Resources/ServerConfig.plist`(SERVER_URL / API_KEY、gitignore 済み。
  雛形は `ServerConfig.example.plist`。作成後は `xcodegen generate` を再実行)
