# TODO

- アプリで写真やビデオを撮影したらiOSの写真アプリで見れるようにする（既存分の書き出しも含む） [plan](docs/plans/save-captures-to-photo-library.md)
  - [x] Phase 1: 権限（NSPhotoLibraryAddUsageDescription）と PhotoLibrarySaver
  - [x] Phase 2: 撮影経路（ContentView.handleCapture）への組み込み
  - [x] Phase 3: 撮影日時・位置の EXIF 焼き込み（PhotoExifWriter）
  - [x] Phase 4: すでにあるメディアの一括書き出し（一時コード）
  - [ ] Phase 5: テスト・実機確認・書き出しの実行・仕様書更新
    - [x] ユニットテスト（PhotoExifWriter / RecordingBarState）・仕様書更新
    - [ ] 実機確認（撮影 → 写真アプリ、権限拒否時の案内）※要ユーザー操作
    - [ ] 実機で backfill を 1 回実行（件数の確認 → 完了アラート → 再起動で 0 件）※要ユーザー操作
  - [ ] Phase 6: 一時コード（PhotoLibraryBackfill）の削除

- アプリの各日の地図に写真を載せる。詳細の方にも載せる
