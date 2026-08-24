import XCTest

/// 「旅行を編集」で出発日を変えると、プランの各日の日付も一緒に動くことの E2E。
/// 位置シミュレーションもサーバも要らない(ローカルの SwiftData だけで完結する)。
final class TripEditShiftUITests: XCTestCase {
    @MainActor
    func testEditingDepartureShiftsPlanDays() throws {
        // 3 日うしろへ動かす。実行日に依らないよう日付はその場で組み立てる
        let calendar = Calendar.current
        let today = Date()
        let target = try XCTUnwrap(calendar.date(byAdding: .day, value: 3, to: today))
        let calendarDayLabel = Self.format(target, as: "EEEE, MMMM d")
        let planDayLabel = Self.format(target, as: "MMM d")

        let app = XCUIApplication()
        app.launch()

        // 旅行を作る(目的地は空 = AI 候補をスキップ。1 日目が今日の日付でできる)
        app.buttons["旅行を作成"].tap()
        let titleField = app.textFields["タイトル(例: 松本旅行)"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 10))
        titleField.tap()
        titleField.typeText("出発日ずらしUIテスト")
        app.buttons["作成"].tap()

        let editButton = app.buttons["旅行を編集"]
        XCTAssertTrue(editButton.waitForExistence(timeout: 10), "旅行を編集が出ない")
        editButton.tap()

        // コンパクトな DatePicker は左が日付・右が時刻。左をタップしてカレンダーを開く
        let datePicker = app.datePickers.firstMatch
        XCTAssertTrue(datePicker.waitForExistence(timeout: 10), "出発日時の DatePicker が出ない")
        datePicker.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()

        // 月をまたぐ場合は次の月へ送ってから日を選ぶ
        if !calendar.isDate(target, equalTo: today, toGranularity: .month) {
            let nextMonth = app.buttons["DatePicker.NextMonth"]
            XCTAssertTrue(nextMonth.waitForExistence(timeout: 5), "次の月のボタンが無い")
            nextMonth.tap()
        }
        let targetDay = app.buttons[calendarDayLabel]
        XCTAssertTrue(
            targetDay.waitForExistence(timeout: 5),
            "カレンダーに \(calendarDayLabel) が無い"
        )
        targetDay.tap()

        // カレンダーを閉じる(シートの何も無いところをタップする)
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: 200, dy: 140))
            .tap()

        // 保存前に動く量を予告する
        XCTAssertTrue(
            app.staticTexts["プランの日付も 3 日うしろへ動きます"].waitForExistence(timeout: 5),
            "プランの日付が動く予告が出ない"
        )

        app.buttons["保存"].tap()

        // プランの 1 日目が新しい出発日に動いている
        let shiftedDay = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", planDayLabel)
        ).firstMatch
        XCTAssertTrue(
            shiftedDay.waitForExistence(timeout: 10),
            "プランの日付が \(planDayLabel) に動いていない"
        )
    }

    private static func format(_ date: Date, as format: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = format
        return formatter.string(from: date)
    }
}
