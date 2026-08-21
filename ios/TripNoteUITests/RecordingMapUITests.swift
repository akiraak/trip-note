import XCTest

/// 記録開始 → 位置シミュレーションで移動 → 停止 → trip 詳細の地図表示までを通しで確認する。
///
/// 前提(手動 or スクリプトで実行):
/// - `xcrun simctl privacy <udid> grant location-always com.akiraak.TripNote`
/// - `xcrun simctl location <udid> start --speed=15 --distance=20 <waypoints...>`
final class RecordingMapUITests: XCTestCase {
    @MainActor
    func testRecordThenShowTripMap() throws {
        let app = XCUIApplication()
        app.launch()

        // 前回の実行が記録中のまま残っていた場合は止める(起動時に自動再開されるため)
        let stopButton = app.buttons["記録を停止"]
        if stopButton.waitForExistence(timeout: 3) {
            stopButton.tap()
        }

        let startButton = app.buttons["記録を開始"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 10))
        startButton.tap()

        XCTAssertTrue(app.staticTexts["記録中"].firstMatch.waitForExistence(timeout: 10))

        // 位置シミュレーションで 10 地点以上貯まるのを待つ
        let enoughPoints = app.staticTexts.matching(
            NSPredicate(format: "label MATCHES %@", "[1-9][0-9]+ 地点")
        ).firstMatch
        XCTAssertTrue(
            enoughPoints.waitForExistence(timeout: 120),
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

        // 地図の表示を確認し、タイル読み込みを待ってスクリーンショットを残す
        XCTAssertTrue(app.maps.firstMatch.waitForExistence(timeout: 15))
        Thread.sleep(forTimeInterval: 5)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "trip-detail-map"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
