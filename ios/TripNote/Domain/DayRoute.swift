import Foundation

enum DayRoute {
    /// 前日までの最後の座標ありチェックポイント(前泊地など)。経路描画の起点になる
    static func anchor(before index: Int, in days: [TripDayEntity]) -> CheckpointEntity? {
        for day in days[..<index].reversed() {
            if let last = day.sortedCheckpoints.last(where: { $0.latitude != nil && $0.longitude != nil }) {
                return last
            }
        }
        return nil
    }
}
