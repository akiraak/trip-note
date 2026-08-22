import XCTest

/// 旅行作成 → 記録開始(旅行の中)→ 位置シミュレーションで移動 → 停止 →
/// trip 詳細の地図表示までを通しで確認する。
///
/// 前提(手動 or スクリプトで実行):
/// - `xcrun simctl privacy <udid> grant location-always com.akiraak.TripNote`
/// - `xcrun simctl location <udid> start --speed=15 --distance=20 <waypoints...>`
final class RecordingMapUITests: XCTestCase {
    @MainActor
    func testRecordThenShowTripMap() throws {
        let app = XCUIApplication()
        app.launch()

        // 前回の実行が記録中のまま残っていた場合は、その旅行を開いて止める
        // (起動時に自動再開されるため。停止ボタンは旅行の中にある)
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
        titleField.typeText("UIテスト記録")
        app.buttons["作成"].tap()

        // 記録はこの旅行に対して開始する
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

        let stopButton = app.buttons["記録を停止"]
        XCTAssertTrue(stopButton.waitForExistence(timeout: 5))
        stopButton.tap()

        // そのまま旅行詳細にいるので、地図の表示を確認し、
        // タイル読み込みを待ってスクリーンショットを残す
        XCTAssertTrue(app.maps.firstMatch.waitForExistence(timeout: 15))
        Thread.sleep(forTimeInterval: 5)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "trip-detail-map"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
