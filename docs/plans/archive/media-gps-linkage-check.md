# 写真・動画と GPS 情報の連携調査

## 目的・背景

撮影した写真・動画と GPS の記録（`location_points`）が連携できているかを確認する。
本番（trip.chobi.me）の「テスト」旅行に写真と GPS 記録が入っているので、実データで裏を取る。

## 調査方法

1. スキーマ（`web/src/lib/db.ts` の `MIGRATIONS`）で紐付けの持ち方を確認する
2. iOS の紐付けロジック（`Domain/MediaAttachment.swift` / `Services/MediaImporter.swift`）を読む
3. 同期の順序（`Services/SyncEngine.swift`）とサーバの受け口（`web/src/app/api/media/route.ts`）を読む
4. 表示側（iOS `TripDetailView` / Web `trips/[id]/page.tsx`）で使われているかを見る
5. 本番 DB の「テスト」旅行の `media` × `location_points` を突き合わせる

## 結論

**連携できている。仕組みは実装済みで、本番の「テスト」旅行のメディア 4 件はすべて GPS 点に紐付いていた。**

### 連携の流れ

| 層 | 実体 |
| --- | --- |
| スキーマ | `media.location_point_id` → `location_points.id`（FK, `on delete set null`） |
| iOS 紐付け | `MediaImporter.insert()` が保存時に `MediaAttachment.nearestIndex()` で**撮影時刻に最も近い記録点**を選び `MediaEntity.locationPoint` に入れる |
| 撮影時刻 | カメラ撮影は `Date()`（`ContentView.swift:212`）、ライブラリ取り込みは EXIF `DateTimeOriginal`、動画はメタデータの `creationDate` |
| 同期 | `SyncEngine.syncNow()` が trips → days → checkpoints → **points → media** の順に送る。`POST /api/media?…&location_point_id=` で id を渡す |
| サーバ | 渡された id が `location_points` に存在すれば保存、無ければ `null`（寛容方針） |
| 表示 (iOS) | `TripDetailView.mediaAnnotations` が `media.locationPoint` から地図マーカーを作る |
| 表示 (Web) | `trips/[id]/page.tsx` が `left join location_points` して `mediaMarkers` を地図に渡す |

### 「テスト」旅行の実データ（trip_id: `7F608FD1-12F9-4277-B12E-D43CB0D88603`）

- `location_points`: 687 点（2026-08-24T05:53:45Z 〜 18:45:04Z）
- `media`: 4 件（うち 1 件は削除済み tombstone）。**4 件とも `location_point_id` が入っている**

| media | 種別 | 撮影時刻 | 紐付いた点の記録時刻 | 時間差 | 座標 |
| --- | --- | --- | --- | --- | --- |
| 0E94B872…（削除済み） | photo | 05:54:22 | 05:53:45 | 37 秒 | 47.68912, -122.36908 |
| F6FA0F43… | photo | 18:16:08 | 18:12:20 | 3 分 48 秒 | 47.68909, -122.36894 |
| C0809E0E… | video | 18:31:02 | 18:30:59 | 3 秒 | 47.74245, -122.34960 |
| B01AF452… | photo | 18:44:36 | 18:44:11 | 25 秒 | 47.74798, -122.36135 |

時間差が開いている 2 件（37 秒 / 3 分 48 秒）は、記録が `distanceFilter = 10m` +
`LocationPointFilter.minDistanceMeters = 5m` で間引かれるため、**静止中は点が増えない**ことによるもの。
実際どちらも直前の点とほぼ同じ座標で、位置としてはずれていない。

## 分かった限界（今回は直していない）

1. **時間差の上限が無い** — `nearestIndex` は最近傍を無条件に返す（`MediaAttachmentTests` の
   「記録範囲の外でも端の点を選ぶ」で意図的に固定済み）。GPS 記録の何時間も後に取り込んだ写真でも、
   記録の端の点に紐付いて地図に出る
2. **後追いの再紐付けが無い** — 紐付けは `insert()` の一度きり。GPS 記録を始める前に写真を取り込むと
   `locationPoint = nil` のまま固定され、その後に点が入っても紐付かない
3. **写真自身の EXIF GPS を使っていない** — `MediaImporter.exifDate()` は `DateTimeOriginal` だけを読む。
   GPS タグ（`kCGImagePropertyGPSDictionary`）は未使用なので、GPS 記録の無い旅行や他端末で撮った写真は
   写真に位置が入っていても地図に出ない
4. **EXIF 日時のタイムゾーン** — `exifDate` はタイムゾーン情報が無い文字列を端末のローカル時刻として解釈する。
   旅行先と端末のタイムゾーンがずれていると、その時差分だけ最近傍の選択がずれる
5. **サーバ側の修復が無い** — `location_point_id` が未知で `null` 保存された行は、後から点が届いても null のまま

## テスト方針

今回はコード変更なしの調査のため、既存テスト（`MediaAttachmentTests`）の確認のみ。
上記の限界に手を入れる場合は `MediaAttachment` に純関数としてルール（許容時間差・EXIF GPS 優先）を足し、
`MediaAttachmentTests` にケースを追加する。
