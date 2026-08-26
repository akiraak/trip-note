# 写真・動画を iOS の写真アプリにも保存する（これから撮る分 + すでに撮った分）（実装プラン）

TODO: 「アプリで写真やビデオを撮影したらiOSの写真アプリで見れるようにする」（既に撮影済みのものも写真ライブラリに入れる）

## 目的・背景

記録バーの📷から撮った写真・動画は**アプリの中にしか残らない**。iOS の写真アプリを開いても無いので、
旅行中に撮ったものを他のアプリで使えず、アプリを消したら（サーバに同期済みでも）端末からは消える。

現状の経路は次のとおり。

- 撮影 UI: `Views/CameraPicker.swift`（`UIImagePickerController(sourceType: .camera)`）
- 受け取り: `ContentView.handleCapture`（`ContentView.swift:219`）→ `MediaImporter.importPhoto` / `importVideo`
- 保存先: `MediaStore`（Application Support/Media/）+ SwiftData の `MediaEntity` のみ

`UIImagePickerController` のカメラは**撮影結果をフォトライブラリへ自動保存しない**（自前でカメラ UI を
組んだ場合と同じ扱い）ため、明示的に `PHPhotoLibrary` へ書く必要がある。写真ライブラリへの
**追加**権限（`.addOnly`）は今のアプリには無い（`PhotosPicker` は out-of-process なので権限不要。
Info.plist にも `NSPhotoLibrary*UsageDescription` は無い）。

**すでにアプリ内にあるメディアも写真アプリへ入れたい**。ここには 2 つの制約がある。

- **原本はもう無い**。アプリ内保存は圧縮版（写真: 最大辺 2560px / JPEG 0.85、動画: 720p mp4）で、
  撮影時の原本は保持していない。書き出せるのはこの圧縮版
- **出どころが記録されていない**。`MediaEntity`（`Models/Entities.swift:222`）には撮影と
  ライブラリ取り込みを区別する情報が無いので、過去分を機械的に選り分けられない。
  `PhotosPicker` で取り込んだ分を書き戻すと、写真アプリに**同じものが 2 つ**並ぶ

既存分の書き出しは**今回 1 回きりの後始末**で、アプリの機能として持ち続けるものではない
（Phase 2 以降に撮ったものは撮影時点で写真アプリに入るため、二度と必要にならない）。
そのため**一時コードとして書いて実機で 1 回実行し、終わったら消す**。UI の導線も恒久的な
スキーマ（`MediaEntity` のフィールド）も足さない。

## 対応方針

新規の撮影は自動保存を恒久機能として入れ、既存分は使い捨ての一括書き出しで片付ける。
どちらもアプリ内の記録（`MediaEntity`）は今までどおり残り、写真アプリ側は**別のコピー**になる
（二重に持つ）。写真アプリへの保存は「おまけの書き出し」で、失敗しても記録の方は必ず残す。

- 自動保存の対象は `CameraPicker` 経由の撮影のみ。`PhotosPicker` で取り込んだものは**元々ライブラリに
  ある**ので保存しない（同じ写真が二重に増える）
- 保存先はカメラロール。「旅ログ」アルバムを作って入れるのは**やらない**（アルバムの作成・取得には
  `.addOnly` ではなく読み書き権限が要り、権限の要求が重くなる。将来課題に回す）
- ON/OFF 設定は作らない（アプリに設定画面が無い）。権限を拒否されたら保存しないだけにする
- 写真アプリ側の**日付と場所は `PHAssetCreationRequest` の `creationDate` / `location` で明示的に付ける**。
  ファイル自身のメタデータに依存しないので、EXIF の落ちている既存分でも正しい日付・場所で並ぶ
  （動画も同じ手が効く）

### Phase 1: 権限と保存サービス

- `Info.plist` / `ios/project.yml` の `info.properties` の両方に
  `NSPhotoLibraryAddUsageDescription`（例: 「撮影した写真・動画を iPhone の写真アプリにも保存します。」）を追加
  - `project.yml` を変えたら `xcodegen generate` を再実行する
- `Services/PhotoLibrarySaver.swift`（新規）を追加する

  ```swift
  /// 写真・動画を iOS のフォトライブラリ(カメラロール)へ追加する。
  /// アプリ内保存(MediaImporter / MediaStore)とは独立で、失敗しても記録側には影響させない。
  enum PhotoLibrarySaver {
      enum SaveError: Error { case denied, failed(Error) }
      static func savePhoto(data: Data, takenAt: Date,
                            coordinate: MediaCoordinate.Coordinate?) async throws
      static func saveVideo(at url: URL, takenAt: Date,
                            coordinate: MediaCoordinate.Coordinate?) async throws
  }
  ```

  - 権限は `PHPhotoLibrary.authorizationStatus(for: .addOnly)`、未確定なら
    `requestAuthorization(for: .addOnly)`。`.denied` / `.restricted` は `SaveError.denied`
  - 追加は `PHPhotoLibrary.shared().performChanges { ... }`（async 版）の中で
    `PHAssetCreationRequest.forAsset()` を作り、`addResource(with:data:options:)` /
    `addResource(with:fileURL:options:)` に加えて `creationDate` / `location`（`CLLocation`）を設定する
  - **`PHAssetResourceCreationOptions.shouldMoveFile` は false（既定）のまま**にする。
    true にすると元ファイルが持って行かれ、撮影直後は `MediaImporter.importVideo` が失敗し、
    既存分の書き出しでは**アプリ内の正本が消える**

### Phase 2: 撮影経路への組み込み（これから撮る分）

- `ContentView.handleCapture`（`ContentView.swift:219`）で、アプリ内取り込みの**前に**
  フォトライブラリへ保存する
  - 写真: 撮影された `UIImage` から書き出し用 JPEG（リサイズなし・品質 0.95）を作って渡す
  - 動画: `CameraPicker` が返す `.mediaURL` の一時ファイルをそのまま渡す。
    **`MediaImporter.importVideo` は先頭でこの一時ファイルを `moveItem` する**
    （`MediaImporter.swift:98-100`）ため、保存を待ってから import を呼ぶ順序が必須
- 保存できた分は Phase 4 の `exportedToPhotoLibraryAt` を立てて、あとの一括書き出しの対象から外す
- 失敗時の扱い
  - 権限拒否（`.denied`）: 保存しない。**初回だけ**「写真アプリへの保存は許可されていません（設定 >
    旅ログ > 写真 で変更できます）」を出し、以後は黙る（`UserDefaults` に案内済みフラグ）。
    毎回出すと撮影のたびに邪魔になる
  - その他の失敗: `MediaImporter.lastError` と同じく記録バーのエラー行に 1 回出す
    （バーは `RecordingBarState` の `error` を表示する）
  - いずれの失敗でも `importPhoto` / `importVideo` は必ず実行する
- **写真アプリに入ることでの副作用**: あとで MEDIA セクションの「写真・動画を追加」
  （`PhotosPicker`）から同じ写真を選ぶと、アプリ内に**二重の `MediaEntity`** ができる。
  自動取り込みや重複検出は今回のスコープ外（運用上の注意として仕様書に書く）

### Phase 3: 撮影日時・位置を EXIF にも焼き込む（これから撮る分）

Phase 2 の JPEG は `UIImage` からの再エンコードなので EXIF を持たない。写真アプリ内の日付・場所は
Phase 1 の `creationDate` / `location` で正しくなるが、**そこから書き出した JPEG ファイル自身**には
何も残らない（他アプリへ渡した先で撮影日時が分からない）。ファイルにも持たせる。

- `Domain/PhotoExifWriter.swift`（新規・純関数、UI にも SwiftData にも依存しない）

  ```swift
  enum PhotoExifWriter {
      /// EXIF(DateTimeOriginal / OffsetTimeOriginal)と GPS を付けた JPEG を作る
      static func jpegData(from image: UIImage, takenAt: Date,
                           coordinate: MediaCoordinate.Coordinate?, quality: CGFloat) -> Data?
  }
  ```

  - `CGImageDestination` に `kCGImagePropertyExifDictionary` / `kCGImagePropertyGPSDictionary` を書く。
    書式は読み側（`Domain/MediaCaptureTime.swift` / `Domain/MediaCoordinate.swift`）に合わせる
- 位置は撮影時点の直近の記録点を使う。`LocationRecorder` の `lastRecorded`（private、
  `LocationRecorder.swift:24`）を読み取り用に公開する。記録していない・まだ 1 点も無いときは nil
  （撮影のたびに単発測位を回すのはコストが高いのでやらない）
- **ついでに揃える**: 同じ座標を `MediaImporter.importPhoto(_:into:takenAt:coordinate:)` にも渡す。
  今はアプリ内カメラ撮影の写真に `latitude` / `longitude` が付かず、地図では記録点への紐付けだけに
  頼っている（`docs/specs/phase4-media.md` の「アプリ内カメラ撮影は … 位置は付かない」）。
  記録中の撮影なら結果はほぼ同じだが、記録点が間引かれている場面で素直になる
  - これは iOS 内部のデータの話で、**Web の表示情報は変わらない**（`latitude` が付くと
    Web 地図のマーカーが `coalesce(m.latitude, p.latitude)` の前者を使うようになるだけ）
- 既存分の書き出し（Phase 4）では**焼き直さない**。JPEG を開いて書き戻すと再エンコードで劣化するので、
  ファイルはそのまま渡し、日付・場所は `creationDate` / `location` に任せる

### Phase 4: すでにアプリ内にあるメディアの書き出し（一時コード・実行後に削除する）

**このフェーズのコードは残さない。** 恒久機能にしないため、次を守る。

- `MediaEntity` にフィールドを足さない（SwiftData のスキーマは変えない）
- UI の導線（ボタン・メニュー項目）を作らない
- 一時コードは 1 ファイルに閉じ、`#if DEBUG` で囲む（実機ビルドは Debug 構成 = `run-ios-device.sh:54`）

実装。

- `Services/PhotoLibraryBackfill.swift`（新規・**一時**）

  ```swift
  #if DEBUG
  /// 【一時コード】写真アプリ保存の対応前に撮った写真・動画をまとめてフォトライブラリへ入れる。
  /// 実機で 1 回流したら、このファイルと ContentView の呼び出しごと削除する。
  enum PhotoLibraryBackfill {
      /// この日時より前のメディアだけが対象(以降は撮影時に自動保存されている)
      static let cutoff = Date(timeIntervalSince1970: ...)   // 実装日を焼き込む
      static func runIfNeeded(modelContext: ModelContext, store: MediaStore) async
  }
  #endif
  ```

  - 対象は全 trip の `MediaEntity` のうち `deletedAt == nil`・`takenAt < cutoff`・
    ファイルが実在するもの（`takenAt` 昇順）
  - **cutoff が要る理由**: Phase 2 の自動保存と同じビルドに入るため、これが無いと
    「撮影時に保存 → backfill でもう 1 回保存」で二重になる
  - 渡すのは `store.url(for: media.fileName)` のファイル（写真は `Data`、動画は URL）。
    日付は `media.takenAt`、場所は `media.displayCoordinate`（自身の EXIF 位置 → 記録点の順に解決済み）
  - 済んだ id は `UserDefaults`（キー `debug.photoLibraryBackfill.doneIDs`）に追記する。
    途中で落ちても再実行で続きから流せる（同じものを二度入れない）
  - 1 件ずつ順に処理し、失敗しても次へ進む。`.denied` だけは以降が全部失敗するので即中断する
  - 完了したら結果をログ（`print`）とアラートで出す: 「N 件を写真アプリに保存しました（M 件失敗）」。
    実行前にも件数の確認を挟む（「N 件を保存します」→ 実行 / やめる）。
    **ライブラリから取り込んだ分も混ざる**（出どころを区別できない）ので、件数を見てから決められるようにする
- 呼び出しは `ContentView` の `.task`（`ContentView.swift:127`）に `#if DEBUG` で 1 行だけ足す
- 後片付けのために **`UserDefaults` のキーは `debug.` 始まりの 1 個だけ**にする。
  コード削除後にキーだけ端末に残るが実害は無い（次の削除コミットでは消さない）

### Phase 5: テストと検証、既存分の書き出し実行

下の「テスト方針」を実施する。実機で Phase 4 を 1 回実行し、写真アプリに入ったことを確認する。
`docs/specs/phase4-media.md` に節を追加する（**恒久機能である Phase 1〜3 だけ**を書き、
backfill は「一度きりの後始末として実施した」と検証結果に 1 行残す）。

### Phase 6: 一時コードの削除

実行を見届けたあと、`Services/PhotoLibraryBackfill.swift` と `ContentView` の呼び出しを削除する
コミットを入れる（`xcodegen generate` の再実行が必要）。**Phase 5 の実機実行が終わるまで消さない。**

## 影響範囲

| Phase | iOS | Web / サーバ |
| --- | --- | --- |
| 1 | `Info.plist`, `project.yml`, `Services/PhotoLibrarySaver.swift`(新規) | なし |
| 2 | `ContentView.swift`, `Views/CameraPicker.swift`（必要なら結果の型） | なし |
| 3 | `Domain/PhotoExifWriter.swift`(新規), `Services/LocationRecorder.swift`, `ContentView.swift` | なし |
| 4 | `Services/PhotoLibraryBackfill.swift`(新規・一時), `ContentView.swift`(`#if DEBUG` の 1 行) | なし |
| 5 | `docs/specs/phase4-media.md` | なし |
| 6 | Phase 4 のファイルと呼び出しを削除 | なし |

- **スキーマ変更なし**（`MediaEntity` は変えない）・API 契約（`docs/specs/server-api.md`）の変更なし・
  同期の挙動変更なし
- **Web は変更なし**。撮影とライブラリ書き出しは iOS 固有の操作なので、CLAUDE.md の
  「揃えるのは表示情報で、操作は別」に該当する
- 新規 Swift ファイルを足すので `xcodegen generate` の再実行が必要

## テスト方針

- ユニットテスト `ios/TripNoteTests/PhotoExifWriterTests.swift`（新規）
  - 書いた JPEG を `MediaImporter.exifDate(from:)` / `exifCoordinate(from:)` で読み戻し、
    撮影日時（秒まで）と緯度経度（南緯・西経の符号を含む）が一致すること
  - 座標 nil のとき GPS 辞書を書かないこと・画像として読めること
- `PhotoLibrarySaver` は `PHPhotoLibrary` 依存のためユニットテストの対象外（判定と変換は
  上記の純関数に寄せる）
- Phase 4 の backfill は**一時コードなのでテストを書かない**。代わりに、実行前の確認アラートで
  対象件数を見る・`print` で 1 件ずつ id と結果を出す、で目視確認する
- ビルドと既存テスト一式
  `xcodebuild -project TripNote.xcodeproj -scheme TripNote -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test`
  （`xcodegen generate` を忘れると 0 件実行で成功扱いになる）
- シミュレータで確認できること（カメラが無いので撮影経路そのものは通せない）
  - `PhotosPicker` で写真・動画を取り込む → cutoff を一時的に未来にして backfill を走らせる →
    許可 → シミュレータの写真アプリに増える
  - **アプリを再起動しても二度目は 0 件**（`doneIDs` による冪等）
  - 書き出したあと、アプリ内の MEDIA から動画が消えていないこと（`shouldMoveFile` の取り違え検知）
- 実機確認（要ユーザー操作）
  1. 初回撮影で写真ライブラリの追加許可ダイアログが出る → 許可
  2. 写真を撮る → **写真アプリの「最近の項目」に出る**。情報を見て撮影日時が今、
     記録中なら地図に撮影地が出ること
  3. 動画を撮る → 写真アプリで再生できること。アプリ内の MEDIA セクションにも出て、
     停止時の同期でサーバにも上がること（＝ 一時ファイルの取り合いが起きていない）
  4. 設定 > 旅ログ > 写真 を「なし」にして撮影 → 案内が 1 回だけ出て、アプリ内の記録は残ること
  5. backfill（Phase 4）: 起動時に件数の確認が出る → 実行 → 完了アラートの件数が対象数と合うこと。
     写真アプリで**撮影日時どおりの日付**に並ぶこと（「最近の項目」の末尾ではなく、撮った日の位置に入る）。
     もう一度起動しても再実行されないこと。ここまで確認できたら Phase 6 で一時コードを消す

## 将来課題（スコープ外）

- 「旅ログ」アルバムへの振り分け（`.addOnly` では作れないため読み書き権限が要る）
- 写真アプリへ保存するかどうかの設定トグル（設定画面ごと）
- 写真アプリ経由で二重取り込みされたメディアの重複検出
- 恒久的な「写真アプリに保存」導線（今回の書き出しは一度きりの一時コードで、必要になったら作り直す）
