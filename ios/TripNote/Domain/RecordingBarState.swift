import Foundation

/// 画面下に常駐する記録バー(RecordingBar)の表示内容を決める純粋ロジック。
/// 「どの旅行を対象にするか」「2 行目に何を出すか」だけを担い、描画には触れない。
enum RecordingBarState {
    /// バーの 2 行目に出す内容
    enum Detail: Equatable {
        /// 記録中の実績(経過時間は時計に合わせて表示側が作る)
        case recording(pointCount: Int, distanceMeters: Double)
        /// 記録中のはずが位置情報が長く途切れている(自動で入れ直しても戻らない)
        case stalled
        /// 対象の旅行はあるが記録していない
        case idle
        /// メディアの取り込み中
        case importing
        /// 位置情報の拒否・エラー。showsSettings が true ならタップで設定アプリへ
        case error(message: String, showsSettings: Bool)
    }

    /// バーに出す内容一式。nil を返す(= バーを出さない)判断は content(for:) が行う
    struct Content {
        /// 撮影・記録の宛先になる旅行
        let trip: TripEntity
        let isRecording: Bool
        let detail: Detail
        /// 経過時間の起点。記録の開始時刻ではなく旅行の開始時刻
        /// (記録は同じ旅行に対して何度でも開始・停止できるため、永続する方を使う)
        let startedAt: Date?
    }

    struct Input {
        /// 一覧に出ている旅行(削除済みは除かれている前提だが、ここでも弾く)
        var trips: [TripEntity] = []
        /// 記録中の旅行。記録していなければ nil
        var recordingTrip: TripEntity?
        /// いま開いている旅行画面・日詳細の旅行(ActiveTripContext)
        var openTrip: TripEntity?
        var recordedPointCount: Int = 0
        var totalDistanceMeters: Double = 0
        var locationError: String?
        var isLocationDenied: Bool = false
        var isImporting: Bool = false
        /// 記録中だが位置情報が長く途切れている(LocationRecorder.isStalled)
        var isStalled: Bool = false
    }

    static let idleText = "記録していません"
    static let importingText = "取り込み中…"
    static let deniedText = "位置情報が許可されていません"
    static let stalledText = "記録中(位置情報を再取得中)"

    /// バーに出す内容。対象の旅行が決まらないときは nil(= バーを出さない)
    static func content(for input: Input) -> Content? {
        guard let trip = targetTrip(for: input) else { return nil }
        let isRecording = input.recordingTrip?.id == trip.id
        return Content(
            trip: trip,
            isRecording: isRecording,
            detail: detail(for: input, isRecording: isRecording),
            startedAt: trip.startedAt
        )
    }

    /// 撮影・記録の宛先。記録中 > 開いている旅行 > 進行中の旅行 の順で決める
    static func targetTrip(for input: Input) -> TripEntity? {
        if let recording = input.recordingTrip, isTargetable(recording) {
            return recording
        }
        if let open = input.openTrip, isTargetable(open) {
            return open
        }
        // 進行中(出発済みで未終了)の旅行。運用上ほぼ 1 件だが、複数なら新しい方を採る
        return input.trips
            .filter { isTargetable($0) && $0.startedAt != nil }
            .max { ($0.startedAt ?? .distantPast) < ($1.startedAt ?? .distantPast) }
    }

    /// 削除済み・終了済みの旅行は記録も撮影もできないので対象にしない
    private static func isTargetable(_ trip: TripEntity) -> Bool {
        trip.deletedAt == nil && trip.endedAt == nil
    }

    private static func detail(for input: Input, isRecording: Bool) -> Detail {
        // 取り込みは数秒で終わる一時表示。終わればエラー・記録状況の表示に戻る
        if input.isImporting {
            return .importing
        }
        if let error = input.locationError {
            return .error(message: error, showsSettings: input.isLocationDenied)
        }
        if input.isLocationDenied {
            return .error(message: deniedText, showsSettings: true)
        }
        if isRecording {
            // 自動の入れ直しでも戻らないときだけ知らせる(短い途切れは黙って直すので出さない)
            if input.isStalled {
                return .stalled
            }
            return .recording(
                pointCount: input.recordedPointCount,
                distanceMeters: input.totalDistanceMeters
            )
        }
        return .idle
    }

    // MARK: - 文言

    /// 経過時間。旅行は数日にまたがるので 24 時間を超えたら日数も出す
    static func elapsedText(from startedAt: Date, to now: Date) -> String? {
        let seconds = Int(now.timeIntervalSince(startedAt))
        guard seconds >= 0 else { return nil }
        let minutes = seconds / 60
        let hours = minutes / 60
        let clock = String(format: "%d:%02d", hours % 24, minutes % 60)
        return hours >= 24 ? "\(hours / 24)日 \(clock)" : clock
    }

    static func pointCountText(_ count: Int) -> String {
        "\(count) 地点"
    }

    static func distanceText(_ meters: Double) -> String {
        ContentView.formatDistance(meters)
    }
}
