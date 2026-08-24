# 写真・動画の一覧を新しい順にする

## 目的・背景

旅行画面の写真・動画グリッドは iOS / Web とも撮影時刻の**昇順**（古いものが先頭）で並んでいる。
撮影・追加した直後のメディアを確認したいことが多いので、**降順（新しいものを上）**に変える。

「撮影もしくは追加日時」は既存の `taken_at` / `takenAt` が該当する
（iOS の取り込みは EXIF / 動画メタデータの撮影日時、取れなければ取り込み時刻を入れている:
`MediaImporter.swift`）。新しいカラムは足さない。

## 対応方針

- iOS: `TripEntity.sortedMedia`（`Models/Entities.swift`）を `takenAt` 降順にする。
  旅行画面のグリッド（`TripDetailView.mediaSection`）と地図ピン（`mediaAnnotations`）が同じ並びになる
- Web: 旅行詳細のメディア取得 SQL（`app/trips/[id]/page.tsx`）を `order by m.taken_at desc` にする
- 同時刻のときの並びが実行ごとに変わらないよう、両方とも `id` を第 2 キーにする
  （Swift の `sorted` は安定ソートではなく、SQL も同値時の順序は未定義のため）

## 影響範囲

- `ios/TripNote/Models/Entities.swift`（`sortedMedia`）
- `ios/TripNote/Views/TripDetailView.swift` は `sortedMedia` 経由なので変更なし
- `web/src/app/trips/[id]/page.tsx`（メディア取得 SQL）
- 同期・紐付け（`SyncEngine` の `SortDescriptor(\.takenAt)`、`lib/media-link.ts`）は
  近傍探索のため昇順が前提。**触らない**

## テスト方針

- iOS: `MediaDeletionTests.一覧は撮影時刻順のまま` を新しい順の期待に更新（名前も変える）
- Web: 一覧の SQL は page 内なので、`npm run lint` / `npm run build` と実画面で確認する
- 既存の Web テスト（`media-api` / `media-link`）は昇順前提のロジック側なので影響なし
