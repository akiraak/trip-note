import CoreLocation
import Foundation

/// 「記録 ON の意思」と「実際に位置情報が届いているか」を突き合わせて、次に何をすべきかだけを
/// 決める純粋ロジック。CoreLocation も SwiftData も触らない（実行は LocationRecorder が行う）。
///
/// 判定に地点数の増減は使わない。`distanceFilter` と `LocationPointFilter` により
/// 静止中は正常でも点が増えないため、「位置情報の更新を受け取った時刻」を生死の目印にする。
enum RecordingWatchdog {
    enum Action: Equatable {
        /// 何もしない（意思どおり動いている、または記録の意思が無い）
        case none
        /// 権限が未確定。許可を求める
        case requestAuthorization
        /// 意思 ON なのに記録していない。記録を再開する
        case resume
        /// 記録中のはずが更新が途切れている。位置情報の購読を入れ直す
        case restart
        /// 権限が無いので自動では戻せない（意思は消さず、許可されたら再開する）
        case denied
    }

    struct Input {
        /// 記録 ON の意思（`TripEntity.isRecordingActive`）を持つ旅行があるか
        var isIntended: Bool = false
        /// LocationRecorder が記録中か（プロセス内の実動）
        var isRecording: Bool = false
        var authorization: CLAuthorizationStatus = .notDetermined
        /// 権限ダイアログの応答待ちか（待っている間は何度も要求しない）
        var isRequestingAuthorization: Bool = false
        /// 位置情報の更新を最後に受け取った時刻。フィルタで点を捨てた場合も更新される。
        /// 記録の開始・入れ直しの時点でも「今」を入れるので、記録中は nil にならない
        var lastUpdateAt: Date?
        var now: Date = Date()
    }

    /// 更新がこれだけ途切れたら止まっているとみなす。
    /// 生きていれば静止中でも数分おきに更新は届く。誤検知しても購読の入れ直しはほぼ無害なので、
    /// 取りこぼしより空振りを選んで長めに取る
    static let staleThreshold: TimeInterval = 10 * 60
    /// 入れ直しても戻らないと判断して表示に出すまでの猶予（＝閾値の 2 倍）
    static let stalledThreshold: TimeInterval = 20 * 60

    static func decide(_ input: Input) -> Action {
        guard input.isIntended else { return .none }
        switch input.authorization {
        case .denied, .restricted:
            return .denied
        case .notDetermined:
            return input.isRequestingAuthorization ? .none : .requestAuthorization
        default:
            break
        }
        guard input.isRecording else { return .resume }
        return isSilent(since: input.lastUpdateAt, at: input.now, longerThan: staleThreshold)
            ? .restart
            : .none
    }

    /// 購読を入れ直しても戻らないほど長く途切れているか（記録バーに出す判断に使う）
    static func isStalled(lastUpdateAt: Date?, now: Date) -> Bool {
        isSilent(since: lastUpdateAt, at: now, longerThan: stalledThreshold)
    }

    private static func isSilent(
        since lastUpdateAt: Date?,
        at now: Date,
        longerThan threshold: TimeInterval
    ) -> Bool {
        // 記録していない間は nil。まだ判断できないので「止まっていない」扱いにする
        guard let lastUpdateAt else { return false }
        return now.timeIntervalSince(lastUpdateAt) > threshold
    }
}
