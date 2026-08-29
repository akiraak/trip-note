import Foundation

/// 旅行画面・一覧の地図と統計に使う、記録点(軌跡)の値型スナップショット。
///
/// SwiftData の `trip.points` を view の body から読むと、記録中は点の追加のたびに
/// 全点のフォールト・並べ替え・距離計算・地図の作り直しが main スレッドで走り、
/// 点が数万件に育った旅行では UI が固まる(2026-08-29 の実障害)。
/// そこで読み出しと集計はバックグラウンド(TrackLoader)で行い、
/// view にはこの不変な値だけを渡す。組み立ては純関数なのでユニットテストできる
struct TrackSnapshot: Equatable, Sendable {
    /// 時間ギャップで区間分割し、描画用に間引き済みの座標列
    var segments: [[RoutePoint]]
    /// 間引き前の全点数(統計表示用)
    var pointCount: Int
    /// 間引き前の全点での総距離(メートル)
    var distanceMeters: Double

    static let empty = TrackSnapshot(segments: [], pointCount: 0, distanceMeters: 0)

    /// 読み出した記録点 1 件(エンティティから写した値型)
    struct Point: Equatable, Sendable {
        let latitude: Double
        let longitude: Double
        let recordedAt: Date
    }

    /// recordedAt 昇順の点列からスナップショットを組み立てる。
    /// displayLimit は描画する座標数の合計上限(統計は間引き前の全点で数える)
    static func make(points: [Point], displayLimit: Int) -> TrackSnapshot {
        let segments = TrackSegmenter.split(points, recordedAt: \.recordedAt)
            .map { segment in
                segment.map { RoutePoint(latitude: $0.latitude, longitude: $0.longitude) }
            }
        return TrackSnapshot(
            segments: downsample(segments, limit: displayLimit),
            pointCount: points.count,
            distanceMeters: Geo.totalDistance(
                coordinates: points.map { ($0.latitude, $0.longitude) }
            )
        )
    }

    /// 全区間合計の座標数を limit 以下に間引く。区間の形と開始・終了マーカーを保つため、
    /// 各区間の最初と最後の点は必ず残す(そのため 2 点区間が多いと合計が limit を超え得る)
    static func downsample(_ segments: [[RoutePoint]], limit: Int) -> [[RoutePoint]] {
        let total = segments.reduce(0) { $0 + $1.count }
        guard total > limit, limit > 0 else { return segments }
        return segments.map { segment in
            // 区間の配分は点数比。首尾を残すため最低 2 点
            let quota = max(2, segment.count * limit / total)
            guard segment.count > quota else { return segment }
            let step = Double(segment.count - 1) / Double(quota - 1)
            return (0..<quota).map { segment[Int((Double($0) * step).rounded())] }
        }
    }
}
