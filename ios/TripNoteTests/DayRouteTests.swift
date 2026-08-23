import Foundation
import Testing
@testable import TripNote

// unmanaged なエンティティ(コンテナ未挿入)で検証する。inverse relationship は
// 自動で張られないため trip.days / day.checkpoints / day.trip を明示的に設定する
@MainActor
struct DayRouteTests {
    private func checkpoint(
        _ name: String, lat: Double? = nil, lng: Double? = nil, order: Int
    ) -> CheckpointEntity {
        CheckpointEntity(type: .sightseeing, name: name, latitude: lat, longitude: lng, sortOrder: order)
    }

    /// 3 日のプラン。1 日目: 松本城(座標あり)→ 宿 A(座標あり)、2 日目: 座標なし CP のみ、
    /// 3 日目: 上高地(座標あり)。前泊地(経路描画の起点)の解決を検証する
    private func makeTrip() -> (TripEntity, [TripDayEntity]) {
        let trip = TripEntity(title: "t")
        let day1 = TripDayEntity(date: "2026-09-01", trip: trip)
        day1.checkpoints = [
            checkpoint("松本城", lat: 36.2381, lng: 137.9690, order: 0),
            checkpoint("宿 A", lat: 36.2300, lng: 137.9700, order: 1),
        ]
        let day2 = TripDayEntity(date: "2026-09-02", trip: trip)
        day2.checkpoints = [checkpoint("どこかのカフェ", order: 0)]
        let day3 = TripDayEntity(date: "2026-09-03", trip: trip)
        day3.checkpoints = [checkpoint("上高地", lat: 36.2500, lng: 137.6300, order: 0)]
        trip.days = [day1, day2, day3]
        return (trip, [day1, day2, day3])
    }

    // MARK: - 前泊地

    @Test func 前泊地は前日の最後の座標ありCP() {
        let (_, days) = makeTrip()
        #expect(DayRoute.anchor(before: 1, in: days)?.name == "宿 A")
    }

    @Test func 前日に座標が無ければさらに前の日を遡る() {
        let (_, days) = makeTrip()
        #expect(DayRoute.anchor(before: 2, in: days)?.name == "宿 A")
    }

    @Test func 初日は前泊地なし() {
        let (_, days) = makeTrip()
        #expect(DayRoute.anchor(before: 0, in: days) == nil)
    }
}
