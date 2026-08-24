# Phase 4: 写真撮影と動画撮影

旅行中に写真・動画を撮影してローカルに保存し、位置情報・時刻に紐付けてサーバへ同期、
iOS / Web の閲覧画面と地図上で見られるようにする。

> 当初プラン(basic-features.md)の「Supabase Storage へのアップロード」は
> g3plus 移行([server-api.md](server-api.md) / [deploy-g3plus.md](deploy-g3plus.md))に伴い、
> Next.js API + サーバのファイルシステム保存に置き換える。

## データフロー

1. iOS で撮影(またはライブラリから取り込み)→ アプリ内ストレージにファイル保存 + SwiftData に `MediaEntity`
2. 同期は trips → points → media の順(media は 1 件ずつファイルをアップロード)
3. サーバはファイルを `<dataDir>/media/<id>.<ext>` に保存し、`media` テーブルに行を insert
4. Web は詳細ページのメディアグリッド + 地図マーカーで表示。ファイルは `/media/[id]` で配信
5. iOS の閲覧はローカルファイルを直接表示(撮影端末 = 閲覧端末のため再ダウンロードしない)

## iOS

### 撮影・取り込み

- **撮影**: 記録中(`LocationRecorder.isRecording`)のみ、ホーム画面にカメラボタンを表示。
  `UIImagePickerController(sourceType: .camera)` を SwiftUI でラップし、写真・動画両対応
  (システム UI 側で切り替え)。カメラ非搭載環境(シミュレータ)ではボタンを出さない
- **ライブラリ取り込み**: `TripDetailView` の MEDIA セクションに「写真・動画を追加」
  (PhotosUI の `PhotosPicker`、画像 + 動画)。**ネイティブカメラアプリで撮った写真・動画を
  後から trip に紐付ける主動線**で、シミュレータでの E2E 確認も兼ねる
  (記録中の撮影は画面下の記録バーの📷から)。撮影時刻は EXIF(`DateTimeOriginal`)/
  動画の `creationDate` から取り、取れなければ現在時刻
- **権限**: `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`(動画の音声)。
  PhotosPicker は out-of-process のため写真ライブラリ権限は不要

### 保存形式(圧縮方針)

- 写真: JPEG に変換(HEIC のブラウザ互換問題を回避)。最大辺 2560px に縮小、品質 0.85(1〜2MB 程度)
- 動画: `AVAssetExportSession` で H.264 / mp4(`AVAssetExportPreset1280x720`)に変換
  (HEVC + .mov は Chrome 系で再生できないため)。変換失敗時は元ファイル(mov)のまま保存
- サムネイル: 写真・動画とも最大辺 480px の JPEG を生成し `<id>-thumb.jpg` で保存
  (グリッド・地図マーカー用。動画は先頭フレーム)
- ファイルは Application Support/Media/ 以下に `<id>.<ext>` で保存(`MediaStore`)

### 位置情報・時刻の紐付け

- `MediaEntity`: id / type(photo|video) / fileName / thumbnailFileName / takenAt /
  trip(cascade で削除)/ locationPoint(nullify)/ needsSync
- 紐付け先の点は「その trip の記録点のうち takenAt に最も近いもの」
  (`Domain/MediaAttachment.swift` の純関数。記録中の撮影なら実質直近の点)。点が無ければ nil

### 削除

- 削除は **iOS だけの操作**(Web は閲覧のみ)。旅行詳細のメディアグリッドの長押し、
  またはフルスクリーンビューアのゴミ箱から。どちらも確認ダイアログを挟む
- `MediaImporter.delete` が**ローカルのファイル(本体・サムネイル)をすぐ消し**、
  行は `MediaEntity.deletedAt`(tombstone)にする。表示(`TripEntity.sortedMedia`・
  地図マーカー)は tombstone を除外する
- 同期(`SyncEngine.pushMedia`)は `deletedAt != nil` のメディアをアップロードの代わりに
  `DELETE /api/media?id=` で送り、成功したら**ローカル行も物理削除**する
  (media は pull しないので tombstone を残す必要がない)。オフライン中の削除は
  tombstone のまま残り次回同期で再送される
- サーバに行が無い(アップロード前に消した)場合の 404 はクライアント側で成功扱い =
  削除は冪等

### 同期

- `SyncEngine` の同期順: trips → points → media(needsSync == true を takenAt 順に 1 件ずつ)
- `POST /api/media?id=&trip_id=&location_point_id=&type=&taken_at=&ext=` に
  `application/octet-stream` でファイル本体を送る(`URLSession.upload(fromFile:)`。
  multipart を組まないのでメモリにファイル全体を載せない)
- 成功(2xx)で needsSync = false。409(trip 未同期)含む失敗時は下ろさず次回再送

## サーバ API(web/)

### DELETE /api/media(Bearer 必須)

- クエリ: `id`(UUID)。ファイル(`storage_path`)を消してから行を削除する
- レスポンス: `200 {"ok":true}` / `400 invalid query` / `401` / `404 not found`
  (クライアントは 404 も成功扱い)

### POST /api/media(Bearer 必須)

- クエリ: `id`(UUID)/ `trip_id` / `type`(photo|video)/ `taken_at`(ISO8601)/
  `ext`(jpg|mp4|mov)/ `location_point_id`(任意)
- ボディ: ファイルバイナリ(上限 200MB → 413)
- trip が存在しなければ `409 {"error":"unknown trip"}`(クライアントは trips を先に送る)。
  location_point_id が存在しない場合は null として保存(points の skip と同じ寛容方針)
- ファイルは `<mediaDir>/<id>.<ext>` に書き込み(tmp に書いて rename)。
  行は immutable なので `insert or ignore`(storage_path = `<id>.<ext>`)。再送は冪等
- レスポンス: `200 {"ok":true}` / `400 invalid query` / `401` / `409` / `413`

### GET /media/[id](Bearer 不要・Cloudflare Access 保護)

- 閲覧 UI(ブラウザ)向けのファイル配信。`/api/*` ではなく `/media/*` に置くことで
  本番は Access の Allow(Google IdP)配下に入る
- `media` 行の storage_path からファイルを解決し、Content-Type(jpg→image/jpeg,
  mp4→video/mp4, mov→video/quicktime)を付けてストリーム返却
- **Range 対応**(`206 Partial Content`): Safari の動画再生は Range 必須
- 内容は不変なので `Cache-Control: private, max-age=31536000, immutable`

### 保存先

- `TRIPNOTE_MEDIA_DIR`(env)。未設定時は DB(`TRIPNOTE_DB_PATH`)と同じディレクトリの
  `media/`。本番は `/app/data/media` になり**既存 volume に含まれるため compose 変更不要**
- 注意: 本番は Cloudflare Tunnel 経由のためアップロードは 1 リクエスト 100MB が上限
  (無料プラン)。720p 圧縮でおおむね数分の動画までは収まる。超える場合は失敗し再送もされ
  続けるため、長尺動画は当面撮らない運用とする(分割アップロードは将来課題)

## 閲覧 UI

### iOS

- `TripDetailView`: 地図の下にメディアグリッド(3 列、サムネイル)。タップでフルスクリーン
  表示(写真: Image / 動画: VideoPlayer)
- `TripMapView`: locationPoint を持つメディアをサムネイルの Annotation で表示。タップで同じビューア

### Web

- `trips/[id]`: メディアセクション(3 列グリッド)。写真は `/media/[id]` を新しいタブで開く、
  動画は `<video controls preload="metadata">` でインライン再生
- 地図(`trip-map.tsx`): locationPoint を持つメディアをサムネイルマーカー(`<a>` + `<img>`)で
  表示。クリックで原本を開く。Web のサムネイルは原本を CSS 縮小(単一ユーザーで枚数も
  限られるため、サーバ側サムネイル生成は将来課題)

## テスト・検証

- iOS ユニットテスト(unmanaged エンティティ): MediaAttachment の最近傍選択、
  MediaUploadMeta のクエリ生成(ISO8601・nil の扱い)、拡張子 / Content-Type マッピング
- Web: `npm run lint` + `npm run build`。dev サーバに curl で
  401 / 400 / 409 / 200 / GET 200 / Range 206 を確認
- シミュレータ E2E: 記録 → ライブラリ取り込み → 同期 → Web で表示
- 実機での撮影確認(カメラ・マイク権限、実撮影)は要ユーザー操作の残タスク

## 検証結果(2026-08-21)

- iOS ユニットテスト 24 件 / Web `npm run lint` + `npm run build` すべて成功
- Web API を curl で検証: 401 / 400 / 409(未知 trip)/ 200 / 再送冪等 /
  GET 200(image/jpeg)/ Range 206(`bytes=a-b` と `bytes=-suffix`)/ 416 / 404
- シミュレータ E2E(`TripNoteUITests/MediaImportUITests`、ローカル dev サーバ相手):
  記録 → PhotosPicker で写真取り込み(EXIF 撮影日時を抽出)→ 最近傍点へ紐付け →
  trips → points → media の順に同期 → サーバにファイル + 行が保存され、
  `GET /media/[id]` と詳細ページ表示まで確認。
  スクリーンショット: `docs/screenshots/phase4-ios-media-simulator.png`
  - UI テスト実行時の注意: **ServerConfig.plist は普段は本番を向いているため、
    シミュレータ E2E の前に必ずローカル dev サーバ向けに差し替える**(終わったら戻す)。
    PhotosPicker の写真は identifier `PXGGridLayout-Info` の Image として見え、
    isHittable にならないため座標タップで選択する
- 本番デプロイ(2026-08-21): サーバ上で `git pull` → rebuild。疎通確認
  `/api/sync` 401/200・`/api/media` 401/400・`/media/[id]` Access 302
- 実機確認(2026-08-21 完了): iPhone のカメラで写真・動画を撮影 → 停止時の自動同期で本番へ。
  サーバに jpg(1920x2560・1.3MB)と mp4(720p 変換・3.4MB)が保存され、どちらも
  location_point に紐付き。`/media/[id]` 配信 200(image/jpeg / video/mp4)・Range 206・
  詳細ページのメディアグリッド/video タグ描画まで確認

## 検証結果(2026-08-24 / 削除と取り込み導線)

- iOS ユニットテスト 164 件成功(削除まわりは `MediaDeletionTests`: tombstone を
  一覧から外す・撮影時刻順の維持・`MediaStore.remove`)
- Web `npm run lint` + `npm run build` 成功。dev サーバに curl で
  `DELETE /api/media` の 401 / 400(不正 id)/ 200(行とファイルが消え、以後
  `GET /media/[id]` は 404)/ 再送 404 を確認
- シミュレータ E2E(`TripNoteUITests/MediaImportUITests`、ローカル dev サーバ相手):
  記録 → MEDIA セクションの「写真・動画を追加」で取り込み → 同期 → サムネイル長押しから
  削除 → 「写真・動画がありません」表示 → 同期。サーバ側は `media` 行 0 件・
  メディアディレクトリ空(dev サーバのログで POST 200 → DELETE 200 を確認)
  - UI テストは旅行詳細がボトムシートになったため、シートを一番高い段へ上げてから
    リスト内をドラッグして MEDIA セクションまでスクロールする(`scrollToVisible`)

## 将来課題(スコープ外)

- trip 削除(tombstone)時のメディアファイル GC。個別削除は
  `DELETE /api/media` で消えるが、旅行ごと消したときのファイルは残る
- サーバ側サムネイル生成、100MB 超動画の分割アップロード
- Web からのメディアアップロード・削除(削除は iOS のみ)
