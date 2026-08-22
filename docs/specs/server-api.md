# サーバ API 仕様

サーバは `web/` の Next.js が兼ねる(閲覧 UI と同一プロセス)。DB は SQLite で、
スキーマの正は `web/src/lib/db.ts` の `MIGRATIONS`
(trips / location_points / media / trip_days / checkpoints)。

## データモデルの概要

- trips は「旅行」単位。`started_at == null` はプラン中(未出発)、
  `ended_at == null` は進行中、両方あれば終了(status カラムは持たず導出)
- trip_days はプランの 1 日(`date` は YYYY-MM-DD)。checkpoints は trip_day に紐付く
  地点(出発地・観光地・宿など。`type` は departure / destination / sightseeing / cafe /
  restaurant / lodging / other)
- プラン系(trips / trip_days / checkpoints)は iOS と双方向同期する。
  `updated_at` はクライアントの編集時刻(LWW の基準)、`deleted_at` は tombstone。
  location_points / media は従来通り不変・一方向アップロード
- trip_days / checkpoints の同期 API(POST /api/sync 拡張・GET /api/sync/pull)は
  Phase 3 で追加予定(iOS 側 DTO は `Models/SyncRecords.swift` に定義済み)

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
    { "id": "uuid", "title": "…", "started_at": "ISO8601|null", "ended_at": "ISO8601|null",
      "transport": "car|null", "deleted_at": "ISO8601|null" }
  ],
  "points": [
    { "id": "uuid", "trip_id": "uuid", "latitude": 0, "longitude": 0,
      "altitude": 0, "accuracy": 0, "recorded_at": "ISO8601" }
  ]
}
```

- trips は「旅行」単位(記録の開始/停止では分割しない)。`started_at` はプラン段階(未出発)では
  null、`deleted_at` は tombstone(物理削除しない)。閲覧 UI は `deleted_at is null` のみ表示
- trips: `ON CONFLICT(id) DO UPDATE`
  (title / started_at / ended_at / transport / deleted_at を更新、updated_at 更新)
- points: 不変のため `INSERT OR IGNORE`。存在しない trip_id を参照する点は FK 違反で全体を
  失敗させず、スキップして `skippedPoints` で返す
- どちらのキーも省略可(iOS は trips だけ → points 500 件ずつの順で送る)

レスポンス:

- `200 {"ok":true,"trips":N,"points":M,"skippedPoints":K}`
- `401 {"error":"unauthorized"}` / `400 {"error":"invalid json"|"invalid payload"}`

## POST /api/media

iOS アプリからのメディアアップロード(1 リクエスト 1 ファイル)。詳細は
[phase4-media.md](phase4-media.md)。

- クエリ: `id` / `trip_id` / `type`(photo|video)/ `taken_at`(ISO8601)/
  `ext`(jpg|mp4|mov)/ `location_point_id`(任意)
- ボディ: ファイルバイナリ(`application/octet-stream`、上限 200MB)
- ファイルは `<dataDir>/media/<id>.<ext>`、行は `insert or ignore` で冪等。
  trip が無ければ `409 {"error":"unknown trip"}`(クライアントは trips → points → media の順に送る)。
  location_point_id が未知なら null で保存
- レスポンス: `200 {"ok":true}` / `400` / `401` / `409` / `413`

## GET /media/[id]

閲覧 UI(ブラウザ)向けのメディア配信。Bearer 不要(`/api/*` ではないので本番は
Cloudflare Access の Allow 配下)。Range 対応(Safari の動画再生に必須)、
`Cache-Control: private, max-age=31536000, immutable`。

## クライアント(iOS)

- `Services/SyncClient.swift`。日付は ISO8601(小数秒付き)、DTO は `Models/SyncRecords.swift`
  (snake_case、nil カラムも明示的に null を送る)
- 接続設定は `Resources/ServerConfig.plist`(SERVER_URL / API_KEY、gitignore 済み。
  雛形は `ServerConfig.example.plist`。作成後は `xcodegen generate` を再実行)
