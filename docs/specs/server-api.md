# サーバ API 仕様

サーバは `web/` の Next.js が兼ねる(閲覧 UI と同一プロセス)。DB は SQLite で、
スキーマの正は `web/src/lib/db.ts` の `MIGRATIONS`
(trips / location_points / media / trip_days / checkpoints / app_settings)。

## データモデルの概要

- trips は「旅行」単位。`started_at == null` はプラン中(未出発)、
  `ended_at == null` は進行中、両方あれば終了(status カラムは持たず導出)
- trip_days はプランの 1 日(`date` は YYYY-MM-DD)。checkpoints は trip_day に紐付く
  地点(出発地・観光地・宿など。`type` は departure / destination / sightseeing / cafe /
  restaurant / lodging / other)
- プラン系(trips / trip_days / checkpoints)は iOS と双方向同期する。
  `updated_at` はクライアントの編集時刻(LWW の基準)、`deleted_at` は tombstone。
  location_points / media は従来通り不変・一方向アップロード
- 競合解決は行単位の LWW: push(POST /api/sync)は `updated_at` が既存より新しい
  ときだけ上書きし、pull(GET /api/sync/pull)は `updated_at > since` の行を
  tombstone 含めて返す。同時刻は既存を保持(単一ユーザーなのでこれで十分)

## 認証

- `/api/*`: `Authorization: Bearer <API_SHARED_SECRET>` 必須(env `API_SHARED_SECRET` と定数時間比較)
- 閲覧ページ(`/`, `/trips/[id]`): アプリ内認証なし。本番は前段の Cloudflare Access(Google IdP)で保護する
- 単一ユーザー(共有プール)。user_id は持たない

## POST /api/sync

iOS アプリからのアップロード(push)。upsert で冪等(id はクライアント発行の UUID)。

リクエスト:

```json
{
  "trips": [
    { "id": "uuid", "title": "…", "started_at": "ISO8601|null", "ended_at": "ISO8601|null",
      "transport": "car|null", "departure_at": "ISO8601|null(出発予定日時)",
      "destination": "上高地|null(目的地)",
      "updated_at": "ISO8601", "deleted_at": "ISO8601|null" }
  ],
  "days": [
    { "id": "uuid", "trip_id": "uuid", "date": "YYYY-MM-DD", "title": "…|null",
      "note": "…|null", "updated_at": "ISO8601", "deleted_at": "ISO8601|null" }
  ],
  "checkpoints": [
    { "id": "uuid", "trip_id": "uuid", "trip_day_id": "uuid", "type": "lodging",
      "name": "…", "latitude": 0, "longitude": 0, "planned_time": "ISO8601|null",
      "note": "…|null", "sort_order": 0, "updated_at": "ISO8601",
      "deleted_at": "ISO8601|null" }
  ],
  "points": [
    { "id": "uuid", "trip_id": "uuid", "latitude": 0, "longitude": 0,
      "altitude": 0, "accuracy": 0, "recorded_at": "ISO8601" }
  ]
}
```

- trips は「旅行」単位(記録の開始/停止では分割しない)。`started_at` はプラン段階(未出発)では
  null、`deleted_at` は tombstone(物理削除しない)。閲覧 UI は `deleted_at is null` のみ表示。
  `departure_at` は出発予定日時(実績の `started_at` とは別。プラン 1 日目の基準)、
  `destination` は目的地の自由記述(AI の日数・宿泊地候補の入力)。どちらも省略可 = null
- trips / days / checkpoints: `ON CONFLICT(id) DO UPDATE ...
  WHERE excluded.updated_at > <table>.updated_at`(行単位の LWW。同時刻は既存を保持)。
  `updated_at` はクライアントの編集時刻。trips のみ省略可(旧クライアント互換。
  省略時はサーバが打刻し、従来通り常に上書きされる)
- checkpoints の `type` は departure / destination / sightseeing / cafe / restaurant /
  lodging / other 以外は 400
- points: 不変のため `INSERT OR IGNORE`
- 親が存在しない行(days の trip_id、checkpoints の trip_id / trip_day_id、points の
  trip_id が未知)は FK 違反で全体を失敗させず、スキップして skipped 数で返す。
  同一ペイロード内の親は先に upsert されるため参照できる
- どのキーも省略可(iOS は trips → days → checkpoints → points 500 件ずつの順で送る)

レスポンス:

- `200 {"ok":true,"trips":N,"days":N,"checkpoints":N,"points":M,
  "skippedDays":K,"skippedCheckpoints":K,"skippedPoints":K}`
- `401 {"error":"unauthorized"}` / `400 {"error":"invalid json"|"invalid payload"}`

## GET /api/sync/pull

iOS がプラン系(trips / trip_days / checkpoints)の変更を取り込む pull。
location_points / media は対象外(一方向アップロードのみ)。

- クエリ: `since`(ISO8601、任意)。指定時は `updated_at > since` の行のみ、
  省略時は全件。tombstone(`deleted_at` あり)も含めて返す
- レスポンスの `serverTime` はサーバの現在時刻。クライアントは適用完了後に保存し、
  次回の `since` に使う(行の読み出し前に確定させるため、読み出し中の更新は
  次回も返り得るが LWW なので重複適用は無害)

レスポンス:

```json
{
  "serverTime": "ISO8601",
  "trips": [ { "id": "…", "title": "…", "started_at": null, "ended_at": null,
    "transport": null, "departure_at": null, "destination": null,
    "updated_at": "…", "deleted_at": null } ],
  "days": [ { "id": "…", "trip_id": "…", "date": "YYYY-MM-DD", "title": null,
    "note": null, "updated_at": "…", "deleted_at": null } ],
  "checkpoints": [ { "id": "…", "trip_id": "…", "trip_day_id": "…", "type": "…",
    "name": "…", "latitude": null, "longitude": null, "planned_time": null,
    "note": null, "sort_order": 0, "updated_at": "…", "deleted_at": null } ]
}
```

- `401 {"error":"unauthorized"}`
- iOS は起動時・フォアグラウンド復帰時・編集後の同期で pull → push の順に実行し、
  行単位の LWW(`updated_at` の新しい方が勝つ、同時刻はローカル保持)で反映する。
  ローカルに無い tombstone 行は取り込まない

## POST /api/ai/plan

AI 行程提案(iOS 向け。Web は Server Action から `web/src/lib/ai.ts` を直接呼ぶ)。
モデルは Web の設定画面(`/settings`)で選択し、サーバの `app_settings`(key `ai_model`)に
保持する(同期対象外。iOS からの呼び出しにも自動で適用)。許可リストは
Claude Opus 5(既定)/ Claude Sonnet 5 / GPT-5.6 Sol / GPT-5.6 Terra の 4 つ
(`web/src/lib/ai.ts` の `AI_MODELS` が正)。API キーは env
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`(使うプロバイダの分だけ設定)。

リクエスト:

```json
{
  "departure": "東京駅",
  "destination": "自宅",
  "startDate": "YYYY-MM-DD",
  "dayCount": 3,
  "transport": "car|null(省略可)",
  "request": "要望の自由記述|null(省略可)"
}
```

レスポンス(提案のみ。DB には書かない。採用するかはクライアントが決め、
採用時は通常の同期/Server Action で trip_days / checkpoints を作る):

```json
{
  "days": [
    { "date": "YYYY-MM-DD", "title": "松本周辺を観光して泊", "area": "松本市",
      "checkpoints": [ { "type": "departure", "name": "東京駅", "note": "…|null",
        "latitude": 35.68, "longitude": 139.76 } ] }
  ]
}
```

- `type` は checkpoints と同じ 7 種(サーバが許可リスト外を other に寄せる)。
  `latitude` / `longitude` は概算座標(市レベル。不正・片方だけは null)。
  採用時にチェックポイントへ保存して地図・ルート表示に使い、
  検索で具体化したら上書きされる
- `401` / `400 {"error":"<バリデーションメッセージ>"}` /
  `500 {"error":"AI (...) の呼び出しに失敗しました: ..."}`(キー未設定・API エラー。
  502/504 だと Cloudflare がボディを差し替えてメッセージが届かないため 500 を使う)
- 生成に数十秒〜数分かかる(iOS 側はタイムアウトを 300 秒にしている)

## POST /api/ai/trip-outline

日数・宿泊地候補(iOS の旅行作成直後に使う)。目的地と出発日時から、日数違いの
大枠候補(各泊の宿泊地付き)を返す。モデル・認証・エラーは /api/ai/plan と同じ。
出発日時はタイムゾーン変換を避けるためクライアントのローカル日付と時刻で送る。

リクエスト:

```json
{
  "destination": "上高地",
  "departureDate": "YYYY-MM-DD",
  "departureTime": "HH:mm",
  "departure": "自宅|null(省略可。出発地 = 1 日目の departure チェックポイント名)",
  "departureLatitude": "47.6|null(省略可。出発地の座標 = 現在地から設定した場合)",
  "departureLongitude": "-122.3|null(省略可)",
  "transport": "car|null(省略可)",
  "request": "要望の自由記述|null(省略可)"
}
```

レスポンス(提案のみ。DB には書かない。採用時はクライアントが 1 日目の日付から
`dayCount` 分の trip_days を揃え、n 泊目の lodging チェックポイントを n 日目に追加する):

```json
{
  "destinationLatitude": 36.25,
  "destinationLongitude": 137.65,
  "candidates": [
    { "dayCount": 3, "title": "2泊3日でゆったり",
      "nights": [ { "area": "松本市街", "name": "松本駅周辺のホテル", "note": "…|null",
        "latitude": 36.23, "longitude": 137.97 } ] }
  ]
}
```

- `nights` は泊数分(通常 `dayCount - 1`)。n 番目 = n+1 泊目。
  `latitude` / `longitude` は地域の概算座標(不正な値は null)。
  候補プレビュー地図に使い、**採用時は宿泊チェックポイントへ概算座標として保存**して
  地図・ルート表示に使う(検索で具体化したら上書きされる)。
  `destinationLatitude` / `destinationLongitude` は目的地の概算座標(候補共通)で、
  採用時に**最終日の destination チェックポイント**(名前 = 旅行の目的地)を作るのに使う。
  `dayCount` が 1〜30 の範囲外の候補はサーバ側で落とす

## POST /api/ai/search-assist

AI 検索補助。大まかな地域 + 種別 + 自由記述から、地図検索(MapKit / Nominatim)の
クエリ候補と具体的な地点候補を返す。モデル・認証・エラーは /api/ai/plan と同じ。

リクエスト:

```json
{ "area": "松本市周辺", "type": "cafe|null(省略可)", "request": "静かなカフェ|null(省略可)" }
```

レスポンス:

```json
{
  "queries": ["松本市 カフェ"],
  "places": [ { "name": "珈琲まるも", "type": "cafe", "area": "松本市", "note": "…|null" } ]
}
```

- クライアントは候補を選ぶとそのクエリで通常の地図検索を実行する
  (座標の確定は地図検索に任せ、AI の座標は信用しない)

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

- `Services/SyncClient.swift`。日付は ISO8601(小数秒付き)、push DTO は
  `Models/SyncRecords.swift`(snake_case、nil カラムも明示的に null を送る)、
  pull DTO は `Models/PullRecords.swift`(小数秒なしの ISO8601 も受け付ける)
- pull 反映(LWW)は `Domain/PlanPull.swift`、実行は `Services/SyncEngine.swift`
  (pull → push の順)。前回 pull の serverTime は UserDefaults(`syncPullSince`)に保存
- AI(/api/ai/*)は `Services/AIClient.swift`(SyncClient の extension)、
  DTO は `Models/AIRecords.swift`(camelCase)、提案の採用は `Domain/PlanEditor.adopt`
- 接続設定は `Resources/ServerConfig.plist`(SERVER_URL / API_KEY、gitignore 済み。
  雛形は `ServerConfig.example.plist`。作成後は `xcodegen generate` を再実行)
