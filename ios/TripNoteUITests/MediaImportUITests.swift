import XCTest

/// 記録 → ライブラリから写真取り込み → 同期までの E2E。
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

        // 前回の実行が記録中のまま残っていた場合は止める
        let stopButton = app.buttons["記録を停止"]
        if stopButton.waitForExistence(timeout: 3) {
            stopButton.tap()
        }

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

        XCTAssertTrue(stopButton.waitForExistence(timeout: 5))
        stopButton.tap()

        // 一覧の先頭 trip を開く
        let tripRow = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "の旅行")
        ).firstMatch
        XCTAssertTrue(tripRow.waitForExistence(timeout: 10))
        tripRow.tap()

        // PhotosPicker からシミュレータ標準の写真を 1 枚選ぶ
        // (グリッドの写真は identifier "PXGGridLayout-Info" の Image として見える)
        app.buttons["ライブラリから追加"].tap()
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
    }
}
