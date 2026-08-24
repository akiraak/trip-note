import XCTest

/// 旅行作成 → 記録(旅行の中)→ ライブラリから写真取り込み → 同期 → 削除までの E2E。
///
/// 前提(手動 or スクリプトで実行):
/// - `xcrun simctl privacy <udid> grant location-always com.akiraak.TripNote`
/// - `xcrun simctl location <udid> start --speed=15 --distance=20 <waypoints...>`
/// - ServerConfig.plist がローカル dev サーバを向いていること(本番を汚さないため)
final class MediaImportUITests: XCTestCase {
    @MainActor
    func testImportPhotoThenSync() throws {
        let app = XCUIApplication()
        app.launch()

        // 前回の実行が記録中のまま残っていた場合は、その旅行を開いて止める
        let recordingRow = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "記録中")
        ).firstMatch
        if recordingRow.waitForExistence(timeout: 3) {
            recordingRow.tap()
            let leftoverStop = app.buttons["記録を停止"]
            if leftoverStop.waitForExistence(timeout: 5) {
                leftoverStop.tap()
            }
            app.navigationBars.buttons.firstMatch.tap()
        }

        // 旅行を作成する(目的地は空 = AI 候補をスキップ)。作成後は旅行の中へ遷移する
        app.buttons["旅行を作成"].tap()
        let titleField = app.textFields["タイトル(例: 松本旅行)"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 10))
        titleField.tap()
        titleField.typeText("UIテスト取込")
        app.buttons["作成"].tap()

        // 記録はこの旅行に対して開始する
        let startButton = app.buttons["記録を開始"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 10))
        startButton.tap()

        // 紐付け先の記録点ができるまで待つ
        let hasPoints = app.staticTexts.matching(
            NSPredicate(format: "label MATCHES %@", "[1-9][0-9]* 地点")
        ).firstMatch
        XCTAssertTrue(
            hasPoints.waitForExistence(timeout: 120),
            "位置情報が貯まらなかった。simctl location のシナリオが動いているか確認する"
        )

        let stopButton = app.buttons["記録を停止"]
        XCTAssertTrue(stopButton.waitForExistence(timeout: 5))
        stopButton.tap()

        // そのまま旅行詳細の MEDIA セクションの「写真・動画を追加」から
        // シミュレータ標準の写真を 1 枚選ぶ
        // (グリッドの写真は identifier "PXGGridLayout-Info" の Image として見える)
        let addMedia = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == %@ OR label == %@", "media-add", "写真・動画を追加")
        ).firstMatch
        guard scrollToVisible(addMedia, in: app) else {
            return XCTFail("写真・動画を追加が見つからない: \(app.debugDescription)")
        }
        addMedia.tap()
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 20), "PhotosPicker の写真が見つからない")
        // リモートビュー(PhotosUI)の要素は isHittable にならないことがあるため座標でタップする
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        // 複数選択モードの確定ボタン(ロケールで「追加」/「Add」)
        for label in ["追加", "Add", "完了", "Done"] {
            let addButton = app.buttons[label]
            if addButton.waitForExistence(timeout: 3) {
                addButton.tap()
                break
            }
        }

        // 取り込み完了(サムネイル表示)を待つ
        let thumbnail = app.buttons["media-thumbnail"].firstMatch
        XCTAssertTrue(thumbnail.waitForExistence(timeout: 30), "取り込んだメディアが表示されない")

        // 地図タイルの読み込みを待ってスクリーンショットを残す
        Thread.sleep(forTimeInterval: 5)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "trip-detail-media"
        attachment.lifetime = .keepAlways
        add(attachment)

        // ホームへ戻って同期(未同期メディアが残らないことまで確認)
        app.navigationBars.buttons.firstMatch.tap()
        let synced = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "同期済み")
        ).firstMatch
        for _ in 0..<3 where !synced.exists {
            let syncButton = app.buttons["今すぐ同期"]
            if syncButton.waitForExistence(timeout: 5), syncButton.isEnabled {
                syncButton.tap()
            }
            _ = synced.waitForExistence(timeout: 20)
        }
        XCTAssertTrue(synced.exists, "同期が完了しなかった")

        // 取り込んだメディアを長押しから削除する(サーバへは DELETE /api/media が飛ぶ)
        app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "UIテスト取込")
        ).firstMatch.tap()
        let importedThumbnail = app.buttons["media-thumbnail"].firstMatch
        guard scrollToVisible(importedThumbnail, in: app) else {
            return XCTFail("削除するサムネイルが見つからない")
        }
        importedThumbnail.press(forDuration: 1.2)
        let deleteInMenu = app.buttons["削除"].firstMatch
        XCTAssertTrue(deleteInMenu.waitForExistence(timeout: 10), "長押しメニューに削除が出ない")
        deleteInMenu.tap()
        // 確認ダイアログの「削除」(メニューが閉じたあとに出る)
        let confirmDelete = app.buttons["削除"].firstMatch
        XCTAssertTrue(confirmDelete.waitForExistence(timeout: 10), "削除の確認が出ない")
        confirmDelete.tap()

        XCTAssertTrue(
            app.staticTexts["写真・動画がありません"].waitForExistence(timeout: 10),
            "削除後にメディアが残っている"
        )

        // ホームへ戻り、削除の同期(未同期メディア 0 件)まで確認する
        app.navigationBars.buttons.firstMatch.tap()
        for _ in 0..<3 where !synced.exists {
            let syncButton = app.buttons["今すぐ同期"]
            if syncButton.waitForExistence(timeout: 5), syncButton.isEnabled {
                syncButton.tap()
            }
            _ = synced.waitForExistence(timeout: 20)
        }
        XCTAssertTrue(synced.exists, "削除の同期が完了しなかった")
    }

    /// シートの中の要素までスクロールする(旅行詳細は地図の上のシートに情報を積んでいて、
    /// List は遅延生成なので下の行はスクロールするまで存在しない)
    @MainActor
    private func scrollToVisible(
        _ element: XCUIElement,
        in app: XCUIApplication,
        attempts: Int = 10
    ) -> Bool {
        let list = app.collectionViews.firstMatch
        guard list.exists else { return false }
        // まずシートを一番高い段へ上げる(つまみは装飾なので座標でタップする)
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: list.frame.midX, dy: list.frame.minY - 12))
            .tap()
        for _ in 0..<attempts {
            if element.exists, element.isHittable { return true }
            // 画面下端は記録バーが浮いているので、その手前から上へドラッグする
            list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
                .press(
                    forDuration: 0.05,
                    thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05))
                )
        }
        return element.exists && element.isHittable
    }
}
