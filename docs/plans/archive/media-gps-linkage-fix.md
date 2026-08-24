# 写真・動画と GPS の紐付けの取りこぼしを減らす（実装）

調査は `docs/plans/archive/media-gps-linkage-check.md` で完了済み。ここはその「分かった限界」を潰す実装プラン。

## 目的・背景

紐付け自体は動いているが、次の 4 つで位置が付かない・ずれる。害の大きさが違うので Phase を分ける。

| # | 症状 | 性質 |
| --- | --- | --- |
| ① | 記録期間から何時間離れていても記録の端の点に紐付く | **誤った位置を表示する**（害が最大） |
| ③ | EXIF 日時を端末ローカル時刻とみなすので、旅行先と時差があるとずれる | 時刻がずれる → ①の判定も狂う |
| ④ | 紐付けは取り込み時の一度きり。点が無い時に取り込むと nil 固定 | 位置が付かない |
| ② | 写真自身の EXIF GPS を使っていない | 位置が付かない（機能追加） |

## 対応方針

### Phase 1: ③ EXIF のタイムゾーン + ① 時間差の上限（iOS のみ）

③ を先に直さないと、①の「時間差」が誤った時刻で測られるので同じ Phase にする。

- **③**: `MediaImporter.exifDate` は `DateTimeOriginal` を端末 TZ で解釈している（`MediaImporter.swift:214`）。
  新しい純関数 `Domain/MediaCaptureTime.swift` に切り出し、次の優先順で絶対時刻にする
  1. EXIF `OffsetTimeOriginal`（EXIF 2.31。iPhone 撮影なら入っている）のオフセット
  2. GPS の `GPSDateStamp` + `GPSTimeStamp`（UTC）との差から推定（15 分単位に丸め、-12:00〜+14:00 の外は不採用）
  3. 端末ローカル（現状の挙動）
- **①**: `MediaAttachment.nearestIndex` に許容時間差を足す。
  **記録範囲 [最初の点, 最後の点] の内側は時間差で弾かない**（`distanceFilter = 10m` +
  `LocationPointFilter.minDistanceMeters = 5m` で静止中は点が増えないため、正しい紐付けでも数十分空く）。
  範囲の外側にはみ出した分だけを上限 **30 分**で制限し、超えたら `nil`（紐付けない）

### Phase 2: ④ 後追いの再紐付け（iOS + Web）

Phase 1 の上限が入ってから着手する（上限が無いまま再紐付けすると誤紐付けが増えるため）。

- **iOS**: 同期の前（`SyncEngine.syncNow()` の冒頭）に、`locationPoint == nil` のメディアを
  Phase 1 と同じルールで再評価する。未アップロードのものは `needsSync` のまま送られるので追加送信は不要
- **Web**: `media` は「不変・一方向アップロード」で `insert or ignore`（`api/media/route.ts:80`）のため、
  iOS が後から `location_point_id` を送り直しても反映されない。**サーバ側で自力修復する**方式にする。
  `/api/sync` で points を受け取った後、その trip の `location_point_id is null` のメディアを
  **iOS と同じルール**（`web/src/lib/media-link.ts` に純関数として置く）で埋める
- 契約変更（サーバが `media.location_point_id` を後から更新する）を `docs/specs/server-api.md` /
  `docs/specs/phase4-media.md` に追記する

### Phase 3: ② 写真・動画自身の EXIF GPS（iOS + Web、スキーマ変更あり）

- `media` に `latitude` / `longitude` を足すマイグレーション（`web/src/lib/db.ts` の `MIGRATIONS` 末尾）
- `POST /api/media` に任意クエリ `latitude` / `longitude` を追加
- iOS: `MediaEntity` に座標を持たせ、`MediaUploadMeta` で送る。取り込み時に
  写真は EXIF GPS（`kCGImagePropertyGPSDictionary`）、動画は `AVAsset` の common `location`（ISO 6709）から読む
- 表示は **メディア自身の座標を優先し、無ければ紐付いた記録点**（iOS `TripDetailView.mediaAnnotations` /
  Web `trips/[id]/page.tsx` の `mediaMarkers`）
- **対象外**: アプリ内カメラ撮影は UIImage 経由で EXIF を持たないため、記録 OFF 時の一発測位は
  この Phase では扱わない（TODO の「GPS の on/off を保存して自動開始」と重なるため）
- **却下案**: EXIF GPS から `location_points` に点を作って紐付ける方式。記録トラックに嘘の点が混ざり、
  距離と経路が壊れる

## 影響範囲

| Phase | iOS | Web |
| --- | --- | --- |
| 1 | `Domain/MediaAttachment.swift`, `Domain/MediaCaptureTime.swift`(新規), `Services/MediaImporter.swift` | なし |
| 2 | `Services/SyncEngine.swift` | `lib/media-link.ts`(新規), `api/sync/route.ts`, specs |
| 3 | `Models/Entities.swift`, `Models/SyncRecords.swift`, `Services/MediaImporter.swift`, `Views/TripDetailView.swift` | `lib/db.ts`, `lib/types.ts`, `api/media/route.ts`, `trips/[id]/page.tsx`, specs |

## テスト方針

- Phase 1: `MediaAttachmentTests` を新ルールに更新（範囲外でも許容内なら紐付く / 超えたら紐付けない）、
  `MediaCaptureTimeTests`（新規）でオフセット指定・GPS 推定・フォールバックの 3 経路
- Phase 2: iOS は再評価の対象選択を純関数側のテストで担保。Web は `lib/media-link.ts` の純関数テスト
- Phase 3: `MediaUploadMetaTests` に座標のクエリ化、Web は型と表示の突き合わせ（`npm run build` / `lint`）
- 新規 Swift ファイルを足したら `xcodegen generate` を再実行してから
  `xcodebuild ... test`（忘れると 0 件実行で成功扱いになる）
