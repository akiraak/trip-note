import Foundation

/// メディアを位置情報に紐付けるロジック(純関数)。
enum MediaAttachment {
    /// 撮影時刻に最も近い記録時刻のインデックスを返す(同差なら先の点)。空なら nil。
    /// 記録中の撮影なら実質的に直近の点が選ばれる。
    static func nearestIndex(recordedTimes: [Date], to takenAt: Date) -> Int? {
        var best: (index: Int, interval: TimeInterval)?
        for (index, time) in recordedTimes.enumerated() {
            let interval = abs(time.timeIntervalSince(takenAt))
            if best == nil || interval < best!.interval {
                best = (index, interval)
            }
        }
        return best?.index
    }
}
