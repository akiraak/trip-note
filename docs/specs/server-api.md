# サーバ API 仕様

サーバは `web/` の Next.js が兼ねる(閲覧 UI と同一プロセス)。DB は SQLite で、
スキーマの正は `web/src/lib/db.ts` の `MIGRATIONS`
(trips / location_points / media / trip_days / checkpoints / app_settings / ai_jobs)。

## データモデルの概要

- trips は「旅行」単位。`started_at == null` はプラン中(未出発)、
  `ended_at == null` は進行中、両方あれば終了(status カラムは持たず導出)
- trip_days はプランの 1 日(`date` は YYYY-MM-DD、`departure_time` は前泊地を出発する
  時刻 "HH:MM" のローカル時刻で任意)。checkpoints は trip_day に紐付く
  地点(出発地・観光地・宿など。`type` は departure / destination / sightseeing / cafe /
  restaurant / lodging / other)
- プラン系(trips / trip_days / checkpoints)は iOS と双方向同期する。
  `updated_at` はクライアントの編集時刻(LWW の基準)、`deleted_at` は tombstone。
  location_points / media は従来通り不変・一方向アップロード
  (例外として media の `location_point_id` だけはサーバが埋め直す。POST /api/sync 参照)
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
      "note": "…|null", "departure_time": "HH:MM|null(省略可)",
      "updated_at": "ISO8601", "deleted_at": "ISO8601|null" }
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
- days の `departure_time` はその日の前泊地を出発する時刻("HH:MM" のローカル時刻。
  日付は `date` が持つ)。旧クライアントは送らないため省略可 = null。
  到着予想時刻は保存せず、クライアントがレグ所要時間(`/api/route` の `durationS`)から
  表示時に導出する
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
- **メディアの紐付け直し**: 点が入った旅行について、`location_point_id` が null の
  メディアを撮影時刻の最近傍の点へ埋め直す(`lib/media-link.ts`。同じトランザクション内)。
  GPS 記録を始める前に取り込んだ写真は iOS 側で null 固定になり、media は不変・
  `INSERT OR IGNORE` で送り直しても反映できないため、点が届いたサーバ側で修復する。
  判定ルール(記録範囲の内側は無条件、外側は 30 分まで)は iOS の `MediaAttachment` と同じ
- どのキーも省略可(iOS は trips → days → checkpoints → points 500 件ずつの順で送る)

レスポンス:

- `200 {"ok":true,"trips":N,"days":N,"checkpoints":N,"points":M,
  "skippedDays":K,"skippedCheckpoints":K,"skippedPoints":K,"relinkedMedia":K}`
- `401 {"error":"unauthorized"}` / `400 {"error":"invalid json"|"invalid payload"}`

## GET /api/sync/pull

iOS がプラン系(trips / trip_days / checkpoints)の変更を取り込む pull。
location_points は対象外(一方向アップロードのみ)。media は**削除だけ**を配る
(本体は一方向アップロードのままなので、返すのは tombstone の
`id` / `trip_id` / `deleted_at`)。

- クエリ: `since`(ISO8601、任意)。指定時は `updated_at > since` の行のみ、
  省略時は全件。tombstone(`deleted_at` あり)も含めて返す。
  media は `deleted_at > since` で絞る(そもそも tombstone しか返さない)
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
    "note": null, "departure_time": null, "updated_at": "…", "deleted_at": null } ],
  "checkpoints": [ { "id": "…", "trip_id": "…", "trip_day_id": "…", "type": "…",
    "name": "…", "latitude": null, "longitude": null, "planned_time": null,
    "note": null, "sort_order": 0, "updated_at": "…", "deleted_at": null } ],
  "media": [ { "id": "…", "trip_id": "…", "deleted_at": "…" } ]
}
```

- `401 {"error":"unauthorized"}`
- iOS は起動時・フォアグラウンド復帰時・編集後の同期で pull → push の順に実行し、
  行単位の LWW(`updated_at` の新しい方が勝つ、同時刻はローカル保持)で反映する。
  ローカルに無い tombstone 行は取り込まない
- `media` は削除の伝搬専用。iOS は受け取った id のローカルのファイル(本体・サムネイル)と
  行を消す(pull で作り直せないため、ローカルには tombstone を残さない)。
  旧サーバは `media` を返さないので、クライアントは**キーの無い応答も受け付ける**

## POST /api/ai/jobs

AI 生成ジョブの登録(iOS 向け)。trip-outline の生成は数十秒〜数分かかり、
接続を張りっぱなしにするとアプリ切替で iOS がソケットを切って
"The network connection was lost" になるため、ジョブ登録 → ポーリングで結果を受け取る。
実装は `web/src/lib/ai-jobs.ts`(生成は応答送信後に next/server の `after()` で実行し、
結果は `ai_jobs.result` に JSON で保持する。提案を trip_days / checkpoints に書かないのは
同期版と同じで、採用はクライアントが決める)。

リクエスト:

```json
{
  "id": "uuid(クライアント発行)",
  "kind": "trip_outline",
  "input": { "…": "/api/ai/trip-outline と同じリクエスト" }
}
```

- 同 id の再送は入力を差し替えず既存ジョブの状態を返す(再送冪等。
  登録応答を取りこぼしたクライアントが安全に再送できる)
- `input` のバリデーションは同期版と同じ(不正なら 400)
- 登録時に 7 日より古いジョブを削除する(掃除)

レスポンス:

- `202 {"id":"…","status":"pending|running|succeeded|failed"}`(既存 id ならその時点の状態)
- `401` / `400 {"error":"<バリデーションメッセージ>"}`

## GET /api/ai/jobs/[id]

ジョブの状態取得(ポーリング用)。

```json
{ "id": "…", "kind": "trip_outline", "status": "succeeded",
  "result": { "…": "同期版と同じレスポンス。succeeded 以外は null" },
  "error": "失敗時のメッセージ。failed 以外は null" }
```

- `401` / `404 {"error":"not found"}`
- pending / running のまま `updated_at` が 10 分以上更新されないジョブは、
  サーバ再起動などで実行が失われたとみなし取得時に failed へ落とす
- iOS は 3 秒間隔でポーリングし、全体 10 分で打ち切る。一時的な通信エラー
  (アプリ切替・電波断)は無視して続行し、サーバが明示的にエラーボディを
  返したときだけ失敗にする

## POST /api/ai/trip-outline

日数・宿泊地候補の同期版(現行 iOS は /api/ai/jobs を使う。Web は Server Action から
`web/src/lib/ai.ts` を直接呼ぶ)。出発地・目的地・出発日時から、日数違いの大枠候補
(各泊の宿泊地付き)を返す。旅行の作成直後だけでなく、**既存プランの続き(帰路など)を
足すとき**も同じ入力で使う(出発地に今のプランの最終地点、目的地に次に向かう先を入れる)。
出発日時はタイムゾーン変換を避けるためクライアントのローカル日付と時刻で送る。

モデルは Web の設定画面(`/settings`)で選択し、サーバの `app_settings`(key `ai_model`)に
保持する(同期対象外。iOS からの呼び出しにも自動で適用)。許可リストは
Claude Opus 5(既定)/ Claude Sonnet 5 / GPT-5.6 Sol / GPT-5.6 Terra の 4 つ
(`web/src/lib/ai.ts` の `AI_MODELS` が正)。API キーは env
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`(使うプロバイダの分だけ設定)。

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

レスポンス(提案のみ。DB には書かない。採用時はクライアントが起点の日(作成直後は
1 日目、続きの追加は入力した出発日)から `dayCount` 分の trip_days を揃え、
n 泊目の lodging チェックポイントを n 日目に追加する):

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
  地図・ルート表示に使う(Google Maps のリンクで位置を設定したら上書きされる)。
  `destinationLatitude` / `destinationLongitude` は目的地の概算座標(候補共通)で、
  採用時に**最終日の destination チェックポイント**(名前 = 旅行の目的地。続きの追加では
  入力した目的地)を作るのに使う。
  `dayCount` が 1〜30 の範囲外の候補はサーバ側で落とす

- `401` / `400 {"error":"<バリデーションメッセージ>"}` /
  `500 {"error":"AI (...) の呼び出しに失敗しました: ..."}`(キー未設定・API エラー。
  502/504 だと Cloudflare がボディを差し替えてメッセージが届かないため 500 を使う)

## POST /api/places/resolve-link

Google Maps の共有リンク(iOS アプリの「共有」・ブラウザ版の「リンクをコピー」)から
場所を取り出す。共有で渡ってくるのは場所名 + 短縮リンク(`https://maps.app.goo.gl/…`)
だけで、座標は短縮リンクを展開した先の URL に入っているため、展開とパースをサーバで
行う(`web/src/lib/google-maps-share.ts`。形式が非公式で変わり得るので 1 箇所に置き、
iOS もこの API を使う)。認証は Bearer、Web は同じ処理を Server Action
(`resolveGoogleMapsLinkAction`)で呼ぶ。

リクエスト:

```json
{ "link": "松本城\nhttps://maps.app.goo.gl/XXXX" }
```

- `link` は共有テキストそのもの(場所名 + URL)でも URL 単体でもよい(最大 4000 文字)。
  中から Google Maps の URL(許可ホスト: `maps.app.goo.gl` / `goo.gl` / `share.google` /
  `maps.google.com` / `www.google.com` / `google.co.jp` 系)を 1 つ取り出す。無ければ 400

レスポンス:

```json
{
  "place": {
    "name": "松本城", "latitude": 36.238653, "longitude": 137.9688674,
    "precision": "pin",
    "resolvedUrl": "https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E/@36.238653,137.9688674,17z/data=...!8m2!3d36.238653!4d137.9688674..."
  }
}
```

- `precision` は `pin`(`!3d<lat>!4d<lng>` または `q=<lat>,<lng>` のピン座標)/
  `center`(`@<lat>,<lng>` の地図の表示中心。ピンとずれることがある)/
  `geocoded`(下記の Nominatim 補完で名前が当たった位置)/ `area`(名前では当たらず住所の
  町丁目までで引いたおおよその位置)/ null(座標が取れなかった)。`geocodedQuery` は
  geocoded / area のとき Nominatim に投げて当たった文字列(それ以外は null)。
  座標が無くても名前が取れれば 200 で返し、クライアントは**座標未設定のまま**
  チェックポイントを追加できる(位置はあとから編集でリンクを貼り直して設定する)。
  名前も座標も取れなければ 500
- **iOS アプリの共有(`?g_st=ic` / `ig` / `com.google.maps.preview.copy`)の展開先は
  `https://www.google.com/maps?q=<名前, 住所>&ftid=0x…:0x…` で座標が無い**(2026-08-23 に
  実物で確認。ページ本文にも無い)。この場合は `q` の「名前 + 住所」と共有テキストの
  1 行目(場所名)から候補を組み、既存の Nominatim プロキシ(`lib/nominatim.ts`)で
  ジオコーディングする。候補の順: 日本の住所(`〒` あり)は「名前 市区町村」→ 名前 →
  町丁目住所(area)、それ以外は q 全文 → 「名前, 市」→ 名前。名前は共有テキストの
  1 行目を優先する(`q` の名前には建物名が混ざる)。Nominatim の呼び出しは候補ごとに
  直列 1 秒間隔なので、当たらないケースは数秒かかる
- 経路のリンク(`/maps/dir/`)は 500(「経路のリンクは取り込めません」)
- 短縮リンクは `redirect: manual` で最大 5 ホップ追い、**転送先も許可ホストの https のみ**
  (SSRF 対策。`consent.google.com` などへ飛んだら失敗)。タイムアウト 10 秒、
  User-Agent は Nominatim と同じ。**座標は展開後の URL からのみ取る**(ページ本文の
  og:image などに出る座標は接続元 IP から推定した既定の地図中心で場所と無関係なため使わない)
- 座標入りの長い URL はサーバから取得せずにパースだけで返す。同じリンクは 24 時間キャッシュ
- チェックポイントの種別はクライアント側で一律 `sightseeing`

## POST /api/route

道路ルート解決。プランのルートを「隣接チェックポイント間のレグ(区間)」の集合として
扱い、レグ単位で実際の道路形状(ポリライン)を返す。実体は OSRM のプロキシ
(`web/src/lib/routing.ts`)で、`route_legs` テーブル(サーバ専用・同期対象外)に
レグ単位で無期限キャッシュする。キャッシュキーは座標ペアを小数 4 桁(約 10m 粒度)で
丸めた `"lat,lon>lat,lon"` なので、チェックポイントの追加・並び替え・座標の具体化では
変わった区間だけが再取得になる。

- ルーティングエンジンは OSRM デモサーバ(`router.project-osrm.org`、car プロファイル)。
  env `OSRM_ENDPOINT` で差し替え可(既定値ありの任意 env)。呼び出しは
  キャッシュミス時のみで、直列 + 最小間隔 1 秒(nominatim と同じ throttle)
- キャッシュは 5000 行を超えた分を古い順に削除。OSRM 失敗(停止・ルート無し)は
  キャッシュしない(次回再試行)

リクエスト(1〜50 レグ。座標は緯度 -90〜90 / 経度 -180〜180):

```json
{ "legs": [ { "from": { "latitude": 36.2381, "longitude": 137.9719 },
              "to":   { "latitude": 36.1451, "longitude": 137.5502 } } ] }
```

レスポンス(入力と同順・同数。解決できないレグは null = クライアントは直線フォールバック):

```json
{ "legs": [ { "coordinates": [[137.9719, 36.2381], [137.55, 36.15]],
              "distanceM": 41234.5, "durationS": 3456.7 } ] }
```

- `coordinates` は GeoJSON LineString と同じ **[lon, lat]** のペア列
- エラー: `400 {"error":"invalid json|invalid payload"}` / `401`

## POST /api/media

iOS アプリからのメディアアップロード(1 リクエスト 1 ファイル)。詳細は
[phase4-media.md](phase4-media.md)。

- クエリ: `id` / `trip_id` / `type`(photo|video)/ `taken_at`(ISO8601)/
  `ext`(jpg|mp4|mov)/ `location_point_id`(任意)/ `latitude` `longitude`(任意)
- `latitude` / `longitude` は**メディア自身の撮影位置**(写真の EXIF GPS・動画メタデータ)。
  地図では記録点(`location_point_id`)よりこちらを優先する。範囲外(±90 / ±180)や
  片方だけの指定は 400
- ボディ: ファイルバイナリ(`application/octet-stream`、上限 200MB)
- ファイルは `<dataDir>/media/<id>.<ext>`、行は `insert or ignore` で冪等。
  trip が無ければ `409 {"error":"unknown trip"}`(クライアントは trips → points → media の順に送る)。
  location_point_id が未知なら null で保存
- レスポンス: `200 {"ok":true}` / `400` / `401` / `409` / `413`

## DELETE /api/media

メディアの削除(1 リクエスト 1 件)。iOS からの同期と Web の削除ボタン
(Server Action)が同じ処理(`web/src/lib/media.ts` の `deleteMedia`)を使う。
**ファイルは物理削除、行は `deleted_at` の tombstone として残す**
(pull で iOS に削除を伝えるため)。

- クエリ: `id`(UUID)
- レスポンス: `200 {"ok":true}` / `400 {"error":"invalid query"}` / `401` /
  `404 {"error":"not found"}`(行がそもそも無いときだけ)
- **クライアントは 404 も成功扱いにする**(アップロード前に削除した場合)。
  tombstone 済みの id への再送も 200 なので、削除は冪等
- 削除済み id への `POST /api/media`(再アップロード)は**ファイルを書かずに
  `200 {"ok":true,"deleted":true}`**。Web で消した直後の再送でファイルが復活しない

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
  DTO は `Models/AIRecords.swift`(camelCase)、提案の採用は `Domain/PlanEditor.adopt`。
  trip-outline はジョブ方式(POST /api/ai/jobs → 3 秒間隔で
  GET /api/ai/jobs/[id]、全体 10 分で打ち切り)
- 道路ルート(/api/route)は `Services/RouteClient.swift`(SyncClient の extension)、
  DTO は `Models/RouteRecords.swift`、レグ組み立ては `Domain/RouteLegs.swift`。
  アプリ内メモリキャッシュ(`RouteLegCache`、レグキー → 座標列)を挟み、
  未解決レグは直線で描く
- 接続設定は `Resources/ServerConfig.plist`(SERVER_URL / API_KEY、gitignore 済み。
  雛形は `ServerConfig.example.plist`。作成後は `xcodegen generate` を再実行)
