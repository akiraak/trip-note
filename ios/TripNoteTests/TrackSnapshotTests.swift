import Foundation
import Testing
@testable import TripNote

// 旅行画面・一覧の軌跡スナップショット(組み立て・間引き)。
// 純ロジックなので値型だけで検証する(docs/plans/trip-screen-freeze.md)
struct TrackSnapshotTests {
    private func point(
        _ latitude: Double, _ longitude: Double, secondsFromEpoch: TimeInterval
    ) -> TrackSnapshot.Point {
        TrackSnapshot.Point(
            latitude: latitude,
            longitude: longitude,
            recordedAt: Date(timeIntervalSince1970: secondsFromEpoch)
        )
    }

    @Test func 統計は間引き前の全点で数える() {
        // 100 点を 10 点に間引いても、地点数・距離は全点のまま
        let points = (0..<100).map { point(35.0 + Double($0) * 0.001, 137.0, secondsFromEpoch: Double($0) * 10) }
        let snapshot = TrackSnapshot.make(points: points, displayLimit: 10)
        #expect(snapshot.pointCount == 100)
        let fullDistance = Geo.totalDistance(coordinates: points.map { ($0.latitude, $0.longitude) })
        #expect(abs(snapshot.distanceMeters - fullDistance) < 0.001)
        #expect(snapshot.segments.reduce(0) { $0 + $1.count } <= 12)
    }

    @Test func 時間ギャップで区間が分かれる() {
        // 10 分超のギャップの前後は別区間(TrackSegmenter と同じ規則)
        let points = [
            point(35.0, 137.0, secondsFromEpoch: 0),
            point(35.001, 137.0, secondsFromEpoch: 60),
            point(35.1, 137.1, secondsFromEpoch: 60 + 11 * 60),
            point(35.101, 137.1, secondsFromEpoch: 60 + 12 * 60),
        ]
        let snapshot = TrackSnapshot.make(points: points, displayLimit: 100)
        #expect(snapshot.segments.count == 2)
        #expect(snapshot.segments[0].count == 2)
        #expect(snapshot.segments[1].count == 2)
    }

    @Test func 上限以下なら間引かない() {
        let segments = [(0..<50).map { RoutePoint(latitude: Double($0), longitude: 0) }]
        #expect(TrackSnapshot.downsample(segments, limit: 50) == segments)
        #expect(TrackSnapshot.downsample(segments, limit: 100) == segments)
    }

    @Test func 間引いても各区間の最初と最後は残る() {
        let first = (0..<1000).map { RoutePoint(latitude: Double($0), longitude: 0) }
        let second = (0..<3000).map { RoutePoint(latitude: 0, longitude: Double($0)) }
        let result = TrackSnapshot.downsample([first, second], limit: 200)
        #expect(result.count == 2)
        #expect(result[0].first == first.first)
        #expect(result[0].last == first.last)
        #expect(result[1].first == second.first)
        #expect(result[1].last == second.last)
        // 配分は点数比(first : second = 1 : 3)。丸めのぶんだけ許容する
        let total = result[0].count + result[1].count
        #expect(total <= 202)
        #expect(result[1].count > result[0].count)
    }

    @Test func 小さい区間が多くても首尾優先で壊れない() {
        // 2 点区間 × 100。limit を下回れなくても各区間 2 点は保つ
        let segments = (0..<100).map { index in
            [RoutePoint(latitude: Double(index), longitude: 0),
             RoutePoint(latitude: Double(index), longitude: 1)]
        }
        let result = TrackSnapshot.downsample(segments, limit: 50)
        #expect(result.count == 100)
        #expect(result.allSatisfy { $0.count == 2 })
    }

    @Test func 空の点列は空のスナップショット() {
        let snapshot = TrackSnapshot.make(points: [], displayLimit: 100)
        #expect(snapshot == .empty)
    }
}
