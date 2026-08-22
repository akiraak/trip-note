import Foundation

/// GPS 切断・記録停止中を線で結ばないための、点列の時間ギャップ区間分割。
/// Web 側 `web/src/lib/geo.ts` の `splitByTimeGap` と同等
enum TrackSegmenter {
    /// この間隔を超えてあいた隣接点は別区間として描画する
    /// (Web 側 TRACK_GAP_THRESHOLD_MS と揃える)
    static let gapThreshold: TimeInterval = 10 * 60

    /// recordedAt 昇順に並んだ点列を、隣接点の時間ギャップが閾値を超えた箇所で区間に分割する
    static func split<Point>(
        _ points: [Point],
        recordedAt: (Point) -> Date,
        gapThreshold: TimeInterval = TrackSegmenter.gapThreshold
    ) -> [[Point]] {
        var segments: [[Point]] = []
        var current: [Point] = []
        for point in points {
            if let last = current.last,
               recordedAt(point).timeIntervalSince(recordedAt(last)) > gapThreshold {
                segments.append(current)
                current = []
            }
            current.append(point)
        }
        if !current.isEmpty {
            segments.append(current)
        }
        return segments
    }
}
