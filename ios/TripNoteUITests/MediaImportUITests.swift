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
        let title = "UIテスト取込"
        let app = XCUIApplication()
        app.launch()

        stopLeftoverRecording(in: app)
        createTripAndRecordOnePoint(in: app, title: title)
        try importPhotoFromLibrary(in: app)

        // 地図タイルの読み込みを待ってスクリーンショットを残す
        Thread.sleep(forTimeInterval: 5)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "trip-detail-media"
        attachment.lifetime = .keepAlways
        add(attachment)

        // ホームへ戻って同期(未同期メディアが残らないことまで確認)
        syncFromHome(in: app)

        // 取り込んだメディアを長押しから削除する(サーバへは DELETE /api/media が飛ぶ)
        openTrip(titled: title, in: app)
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
        syncFromHome(in: app)
    }

    /// Web(サーバ)側で削除されたメディアが、次の同期(pull)でローカルからも消えることの E2E。
    /// dev サーバを直接叩くため、URL と API キーを環境変数で渡したときだけ実行する。
    /// テストはシミュレータの中で動くので、**`TEST_RUNNER_` を付けて**渡す(付けないと届かず skip される):
    /// `TEST_RUNNER_TRIPNOTE_TEST_SERVER_URL=http://localhost:3111 \`
    /// `TEST_RUNNER_TRIPNOTE_TEST_API_KEY=<鍵> xcodebuild ... test`
    @MainActor
    func testServerDeletedMediaDisappearsAfterSync() async throws {
        guard let server = TestServer.fromEnvironment() else {
            throw XCTSkip("TRIPNOTE_TEST_SERVER_URL / TRIPNOTE_TEST_API_KEY が未設定")
        }
        let title = "UIテストWeb削除"
        let app = XCUIApplication()
        app.launch()

        stopLeftoverRecording(in: app)
        createTripAndRecordOnePoint(in: app, title: title)
        try importPhotoFromLibrary(in: app)
        syncFromHome(in: app)

        // ここが「Web の削除ボタン」に相当する(同じ DELETE /api/media を叩く)
        let tripId = try await server.newestTripId(titled: title)
        let mediaIds = try await server.mediaIds(tripId: try XCTUnwrap(tripId))
        let mediaId = try XCTUnwrap(mediaIds.first, "Web の旅行詳細にメディアが出ていない")
        let status = try await server.deleteMedia(id: mediaId)
        XCTAssertEqual(status, 200, "サーバ側の削除に失敗した")

        // 同期すると pull で tombstone を受け取り、ローカルのファイルごと消える
        syncFromHome(in: app)
        openTrip(titled: title, in: app)
        let empty = app.staticTexts["写真・動画がありません"]
        XCTAssertTrue(
            scrollToVisible(empty, in: app),
            "Web で削除したメディアが iOS に残っている"
        )
    }

    // MARK: - 手順の部品

    /// 前回の実行が記録中のまま残っていたら、その旅行を開いて止める
    @MainActor
    private func stopLeftoverRecording(in app: XCUIApplication) {
        let recordingRow = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "記録中")
        ).firstMatch
        guard recordingRow.waitForExistence(timeout: 3) else { return }
        recordingRow.tap()
        let leftoverStop = app.buttons["記録を停止"]
        if leftoverStop.waitForExistence(timeout: 5) {
            leftoverStop.tap()
        }
        app.navigationBars.buttons.firstMatch.tap()
    }

    /// 旅行を作って記録を開始し、メディアの紐付け先になる点が 1 つ貯まったら止める
    @MainActor
    private func createTripAndRecordOnePoint(in app: XCUIApplication, title: String) {
        app.buttons["旅行を作成"].tap()
        let titleField = app.textFields["タイトル(例: 松本旅行)"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 10))
        titleField.tap()
        titleField.typeText(title)
        app.buttons["作成"].tap()

        let startButton = app.buttons["記録を開始"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 10))
        startButton.tap()

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
    }

    /// 旅行詳細の MEDIA セクションから、シミュレータ標準の写真を 1 枚取り込む
    /// (グリッドの写真は identifier "PXGGridLayout-Info" の Image として見える)
    @MainActor
    private func importPhotoFromLibrary(in app: XCUIApplication) throws {
        let addMedia = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == %@ OR label == %@", "media-add", "写真・動画を追加")
        ).firstMatch
        guard scrollToVisible(addMedia, in: app) else {
            throw XCTSkip("写真・動画を追加が見つからない")
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
        XCTAssertTrue(
            app.buttons["media-thumbnail"].firstMatch.waitForExistence(timeout: 30),
            "取り込んだメディアが表示されない"
        )
    }

    /// ホームへ戻って同期する(すでにホームなら戻らない)
    @MainActor
    private func syncFromHome(in app: XCUIApplication) {
        // 旅行の中にいたらホームへ戻る(ホームには「旅行を作成」がある)
        if !app.buttons["旅行を作成"].exists {
            app.navigationBars.buttons.firstMatch.tap()
        }
        let synced = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "同期済み")
        ).firstMatch
        for _ in 0..<3 {
            let syncButton = app.buttons["今すぐ同期"]
            if syncButton.waitForExistence(timeout: 5), syncButton.isEnabled {
                syncButton.tap()
            }
            if synced.waitForExistence(timeout: 20) { return }
        }
        XCTAssertTrue(synced.exists, "同期が完了しなかった")
    }

    @MainActor
    private func openTrip(titled title: String, in app: XCUIApplication) {
        let row = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", title)
        ).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "旅行 \(title) が一覧に無い")
        row.tap()
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

/// UI テストから dev サーバを直接叩くための最小クライアント。
/// 「Web で削除した」状況を作るために使う(本番を叩かないよう環境変数で明示的に渡す)
private struct TestServer {
    let baseURL: URL
    let apiKey: String

    static func fromEnvironment() -> TestServer? {
        let environment = ProcessInfo.processInfo.environment
        guard
            let urlString = environment["TRIPNOTE_TEST_SERVER_URL"],
            let baseURL = URL(string: urlString),
            let apiKey = environment["TRIPNOTE_TEST_API_KEY"],
            !apiKey.isEmpty
        else { return nil }
        return TestServer(baseURL: baseURL, apiKey: apiKey)
    }

    /// タイトルが一致する最新の旅行の id(pull API から引く)
    func newestTripId(titled title: String) async throws -> String? {
        let data = try await get(baseURL.appending(path: "api/sync/pull"), authorized: true)
        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let trips = json["trips"] as? [[String: Any]]
        else { return nil }
        let matching = trips.filter {
            $0["title"] as? String == title && !($0["deleted_at"] is String)
        }
        let newest = matching.max {
            ($0["updated_at"] as? String ?? "") < ($1["updated_at"] as? String ?? "")
        }
        return newest?["id"] as? String
    }

    /// Web の旅行詳細ページに出ているメディアの id(`/media/<id>` から拾う)
    func mediaIds(tripId: String) async throws -> [String] {
        let data = try await get(baseURL.appending(path: "trips/\(tripId)"), authorized: false)
        let html = String(decoding: data, as: UTF8.self)
        var ids: [String] = []
        for match in html.matches(of: /\/media\/([0-9a-fA-F-]{36})/) {
            let id = String(match.1)
            if !ids.contains(id) { ids.append(id) }
        }
        return ids
    }

    /// Web の削除ボタンと同じ処理(DELETE /api/media)
    func deleteMedia(id: String) async throws -> Int {
        guard
            var components = URLComponents(
                url: baseURL.appending(path: "api/media"),
                resolvingAgainstBaseURL: false
            )
        else { return -1 }
        components.queryItems = [URLQueryItem(name: "id", value: id)]
        guard let url = components.url else { return -1 }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? -1
    }

    private func get(_ url: URL, authorized: Bool) async throws -> Data {
        var request = URLRequest(url: url)
        if authorized {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
        let (data, _) = try await URLSession.shared.data(for: request)
        return data
    }
}
