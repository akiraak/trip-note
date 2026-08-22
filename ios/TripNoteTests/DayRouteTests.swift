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
    /// 3 日目: 上高地(座標あり)
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

    // MARK: - 経路

    @Test func 経路は前泊地と訪問順CPで座標なしも名前だけ含む() {
        let (_, days) = makeTrip()
        let places = DayRoute.places(for: days[1])
        #expect(places.map(\.name) == ["宿 A", "どこかのカフェ"])
        #expect(places[0].latitude == 36.2300)
        #expect(places[1].latitude == nil)
    }

    @Test func 初日の経路は前泊地なしで始まる() {
        let (_, days) = makeTrip()
        #expect(DayRoute.places(for: days[0]).map(\.name) == ["松本城", "宿 A"])
    }

    // MARK: - 検索範囲

    @Test func 座標が無ければ検索範囲はnil() {
        let places = [DayRoutePlace(name: "x", latitude: nil, longitude: nil)]
        #expect(DayRoute.searchRegion(for: places) == nil)
        #expect(DayRoute.searchRegion(for: []) == nil)
    }

    @Test func 近接した経路でも一辺は最低20km() throws {
        let places = [
            DayRoutePlace(name: "a", latitude: 36.2381, longitude: 137.9690),
            DayRoutePlace(name: "b", latitude: 36.2300, longitude: 137.9700),
        ]
        let region = try #require(DayRoute.searchRegion(for: places))
        #expect(region.spanMeters == DayRoute.minimumSpanMeters)
        #expect(abs(region.center.latitude - 36.23405) < 1e-6)
        #expect(abs(region.center.longitude - 137.9695) < 1e-6)
    }

    @Test func 長い経路は外接矩形の長辺に余白を掛けた一辺になる() throws {
        // 松本 → 上高地(東西約 30km)
        let places = [
            DayRoutePlace(name: "宿 A", latitude: 36.2300, longitude: 137.9700),
            DayRoutePlace(name: "上高地", latitude: 36.2500, longitude: 137.6300),
        ]
        let region = try #require(DayRoute.searchRegion(for: places))
        let width = Geo.haversineDistance(lat1: 36.24, lng1: 137.9700, lat2: 36.24, lng2: 137.6300)
        #expect(abs(region.spanMeters - width * DayRoute.spanScale) < 1)
        #expect(region.spanMeters > DayRoute.minimumSpanMeters)
    }
}
