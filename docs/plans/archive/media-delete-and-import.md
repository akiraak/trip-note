# 写真・動画の削除と、カメラアプリで撮ったものの取り込み

## 目的・背景

- **削除ができない**: 撮影・取り込みしたメディアは iOS / Web / サーバのどこからも削除できない
  (`docs/specs/phase4-media.md` の将来課題に「そもそも削除 UI が未実装」と記載)。
  試し撮り・失敗写真がそのまま端末とサーバに残り続ける
- **カメラアプリで撮ったものを取り込む導線が分かりにくい**: 機能自体は
  `TripDetailView` のツールバー(アイコンだけの PhotosPicker)にあるが、
  MEDIA セクションからは見えず気づけない。実機ではネイティブカメラで撮る方が速いので、
  「あとから旅行に紐付ける」導線を主動線として見える形にする

## 対応方針(2026-08-23 にユーザーと確認)

1. **取り込み**: 写真ライブラリ権限を増やす自動取り込みはやらない。
   MEDIA セクションに**ラベル付きの「写真・動画を追加」ボタン(PhotosPicker)** を出し、
   ツールバーのアイコンだけの導線はそちらへ一本化する
2. **削除**: iOS で削除したらサーバの行とファイルも消す(Web の表示からも消える)。
   Web 側は閲覧のみ(操作の差はプラットフォーム都合として許容 = CLAUDE.md の
   「揃えるのは表示情報で、操作は別」)

### 削除の同期モデル

media は不変・一方向アップロード(pull 対象外)なので、削除も **push のみ**で表現する。

- ローカル: `MediaEntity.deletedAt`(tombstone)を追加。削除操作で
  `deletedAt = 現在時刻` / `needsSync = true` にし、**ローカルのファイル(本体・サムネイル)は
  即削除**する(容量をすぐ解放する。表示は tombstone を除外するので参照されない)
- 同期: `SyncEngine.pushMedia` が `needsSync` のメディアを見るとき、
  `deletedAt != nil` なら `DELETE /api/media?id=` を送る。成功したら**ローカル行も物理削除**する
  (media は pull しないので tombstone を残す必要がない)
- サーバに行が無い(アップロード前に削除した)場合も DELETE を送る。サーバの 404 は
  クライアント側で成功扱いにする(冪等。アップロード応答を取りこぼしていた場合の
  サーバ側の孤児行も確実に消える)
- オフライン中の削除は tombstone として残り、次回同期で再送される

## 影響範囲

### iOS

- `Models/Entities.swift`: `MediaEntity.deletedAt` 追加、`TripEntity.sortedMedia` で tombstone を除外
  (optional 追加なので SwiftData の軽量マイグレーションで済む)
- `Services/MediaStore.swift`: `remove(fileName:)` 追加
- `Services/MediaImporter.swift`: `delete(_:)` 追加(ファイル削除 + tombstone + save)
- `Services/SyncClient.swift`: `deleteMedia(id:)` 追加(404 は成功扱い)
- `Services/SyncEngine.swift`: `pushMedia` を「削除は DELETE、それ以外は従来のアップロード」に分岐
- `Views/MediaViews.swift`: `MediaViewerView` に削除ボタン + 確認ダイアログ
- `Views/TripDetailView.swift`: MEDIA セクションに「写真・動画を追加」ボタン、
  サムネイルの長押しメニューに削除、ツールバーの PhotosPicker を撤去

### Web / サーバ

- `src/app/api/media/route.ts`: `DELETE`(Bearer / `id` クエリ)を追加。
  行の `storage_path` のファイルを消してから行を削除。無ければ 404
- 表示側の変更は無し(行が消えれば旅行詳細のメディアグリッド・地図マーカーからも消える)

### ドキュメント

- `docs/specs/server-api.md`: DELETE /api/media を追記
- `docs/specs/phase4-media.md`: 削除の節を追加し、将来課題の「削除 UI が未実装」を解消

## Phase

- **Phase 1**: サーバ `DELETE /api/media` + docs 更新
- **Phase 2**: iOS の削除(モデル・ストア・同期・UI)
- **Phase 3**: 取り込み導線の明示化(MEDIA セクションのボタン化)
- **Phase 4**: 検証

## テスト方針

- iOS ユニットテスト(unmanaged エンティティ): `sortedMedia` が tombstone を除くこと、
  `MediaStore.remove` が本体・サムネイルを消すこと(一時ディレクトリで実ファイル操作)
- Web: `npm run lint` + `npm run build`、dev サーバへ curl で
  DELETE の 401 / 400 / 404 / 200(行とファイルが消える)/ 再送 404 を確認
- iOS ビルド + 既存テスト一式(`xcodebuild ... test`)
- シミュレータでの目視: 取り込み(PhotosPicker)→ 削除 → 同期 → Web から消えていること
