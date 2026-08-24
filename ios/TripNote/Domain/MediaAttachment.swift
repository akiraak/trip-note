import Foundation

/// メディアを位置情報に紐付けるロジック(純関数)。
enum MediaAttachment {
    /// 記録範囲の外側で許す時間差の上限。
    ///
    /// 範囲の内側は時間差で弾かない: 記録は `distanceFilter = 10m` +
    /// `LocationPointFilter.minDistanceMeters` で間引かれるため、静止中は点が増えず、
    /// 正しい紐付けでも数十分以上空くことがある。一方で記録の外にはみ出した撮影
    /// (記録前・記録後に取り込んだ写真)は端の点に引き寄せられて嘘の位置になるので、
    /// はみ出し分だけをこの上限で制限する。
    static let outsideTolerance: TimeInterval = 30 * 60

    /// 撮影時刻に最も近い記録時刻のインデックスを返す(同差なら先の点)。
    /// 記録範囲から `tolerance` より外れた撮影は紐付けない(nil)。空なら nil。
    /// 記録中の撮影なら実質的に直近の点が選ばれる。
    static func nearestIndex(
        recordedTimes: [Date],
        to takenAt: Date,
        tolerance: TimeInterval = outsideTolerance
    ) -> Int? {
        var best: (index: Int, interval: TimeInterval)?
        var earliest: Date?
        var latest: Date?
        for (index, time) in recordedTimes.enumerated() {
            let interval = abs(time.timeIntervalSince(takenAt))
            if best == nil || interval < best!.interval {
                best = (index, interval)
            }
            if earliest == nil || time < earliest! { earliest = time }
            if latest == nil || time > latest! { latest = time }
        }
        guard let best, let earliest, let latest else { return nil }
        if
            takenAt < earliest.addingTimeInterval(-tolerance)
            || takenAt > latest.addingTimeInterval(tolerance)
        {
            return nil
        }
        return best.index
    }
}
