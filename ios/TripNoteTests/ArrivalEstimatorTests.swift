import Foundation
import Testing
@testable import TripNote

// メモ: PlanPullTests と同じく、unmanaged なエンティティ(コンテナ未挿入)だけで検証する。
@MainActor
struct ArrivalEstimatorTests {
    private let start = RoutePoint(latitude: 36.0, longitude: 138.0)
    private let p1 = RoutePoint(latitude: 36.1, longitude: 138.0)
    private let p2 = RoutePoint(latitude: 36.2, longitude: 138.0)
    private let p3 = RoutePoint(latitude: 36.3, longitude: 138.0)

    private func checkpoint(
        _ point: RoutePoint?,
        plannedTime: Date? = nil
    ) -> CheckpointEntity {
        CheckpointEntity(
            type: .sightseeing,
            name: "cp",
            latitude: point?.latitude,
            longitude: point?.longitude,
            plannedTime: plannedTime
        )
    }

    private func resolved(
        _ legs: [(from: RoutePoint, to: RoutePoint, durationS: Double)]
    ) -> [String: ResolvedRouteLeg] {
        var store: [String: ResolvedRouteLeg] = [:]
        for leg in legs {
            store[RouteLeg(from: leg.from, to: leg.to).key] = ResolvedRouteLeg(
                points: [leg.from, leg.to], distanceM: 0, durationS: leg.durationS
            )
        }
        return store
    }

    @Test func 出発時刻からレグ所要時間を累積して予想する() throws {
        let anchor = try #require(
            ArrivalEstimator.departureDate(dayDate: "2026-09-01", departureTime: "08:00")
        )
        let cp1 = checkpoint(p1)
        let cp2 = checkpoint(p2)
        let estimates = ArrivalEstimator.estimates(
            dayDate: "2026-09-01",
            departureTime: "08:00",
            routeStart: start,
            checkpoints: [cp1, cp2],
            resolvedLegs: resolved([(start, p1, 3600), (p1, p2, 1800)])
        )
        #expect(estimates[cp1.id] == anchor.addingTimeInterval(3600))
        #expect(estimates[cp2.id] == anchor.addingTimeInterval(5400))
    }

    @Test func plannedTimeのあるCPで再アンカーしそのCP自体は予想なし() throws {
        let planned = Date(timeIntervalSince1970: 1_000_000)
        let cp1 = checkpoint(p1)
        let cp2 = checkpoint(p2, plannedTime: planned)
        let cp3 = checkpoint(p3)
        let estimates = ArrivalEstimator.estimates(
            dayDate: "2026-09-01",
            departureTime: "08:00",
            routeStart: start,
            checkpoints: [cp1, cp2, cp3],
            resolvedLegs: resolved([(start, p1, 3600), (p1, p2, 1800), (p2, p3, 600)])
        )
        // 手入力の予定時刻がある CP は予想を出さず、以降はそこから再連鎖する
        #expect(estimates[cp2.id] == nil)
        #expect(estimates[cp3.id] == planned.addingTimeInterval(600))
    }

    @Test func 未解決レグ以降は予想なしで次のplannedTimeから再開する() throws {
        let planned = Date(timeIntervalSince1970: 2_000_000)
        let cp1 = checkpoint(p1)
        let cp2 = checkpoint(p2)
        let cp3 = checkpoint(p3, plannedTime: planned)
        let cp4 = checkpoint(start)
        let estimates = ArrivalEstimator.estimates(
            dayDate: "2026-09-01",
            departureTime: "08:00",
            routeStart: start,
            checkpoints: [cp1, cp2, cp3, cp4],
            // p1→p2 のレグが未解決
            resolvedLegs: resolved([(start, p1, 3600), (p3, start, 600)])
        )
        #expect(estimates[cp1.id] != nil)
        #expect(estimates[cp2.id] == nil)
        #expect(estimates[cp4.id] == planned.addingTimeInterval(600))
    }

    @Test func 出発時刻も手前のplannedTimeも無ければ予想なし() throws {
        let cp1 = checkpoint(p1)
        let cp2 = checkpoint(p2)
        let estimates = ArrivalEstimator.estimates(
            dayDate: "2026-09-01",
            departureTime: nil,
            routeStart: start,
            checkpoints: [cp1, cp2],
            resolvedLegs: resolved([(start, p1, 3600), (p1, p2, 1800)])
        )
        #expect(estimates.isEmpty)
    }

    @Test func 座標なしCPは予想なしでレグはそれを飛ばして連鎖する() throws {
        let anchor = try #require(
            ArrivalEstimator.departureDate(dayDate: "2026-09-01", departureTime: "08:00")
        )
        let cp1 = checkpoint(p1)
        let noCoords = checkpoint(nil)
        let cp2 = checkpoint(p2)
        let estimates = ArrivalEstimator.estimates(
            dayDate: "2026-09-01",
            departureTime: "08:00",
            routeStart: start,
            checkpoints: [cp1, noCoords, cp2],
            // レグ組み立てと同様、座標なし CP を飛ばした p1→p2 のレグで繋がる
            resolvedLegs: resolved([(start, p1, 3600), (p1, p2, 1800)])
        )
        #expect(estimates[noCoords.id] == nil)
        #expect(estimates[cp2.id] == anchor.addingTimeInterval(5400))
    }

    @Test func 一日目は出発CPのplannedTimeがアンカーになる() throws {
        let departureAt = Date(timeIntervalSince1970: 3_000_000)
        let departure = checkpoint(start, plannedTime: departureAt)
        let cp1 = checkpoint(p1)
        let estimates = ArrivalEstimator.estimates(
            dayDate: "2026-09-01",
            departureTime: nil,
            routeStart: nil,
            checkpoints: [departure, cp1],
            resolvedLegs: resolved([(start, p1, 3600)])
        )
        #expect(estimates[departure.id] == nil)
        #expect(estimates[cp1.id] == departureAt.addingTimeInterval(3600))
    }

    @Test func departureDateは不正な時刻をnilにする() {
        #expect(ArrivalEstimator.departureDate(dayDate: "2026-09-01", departureTime: nil) == nil)
        #expect(ArrivalEstimator.departureDate(dayDate: "2026-09-01", departureTime: "24:00") == nil)
        #expect(ArrivalEstimator.departureDate(dayDate: "2026-09-01", departureTime: "0830") == nil)
        #expect(ArrivalEstimator.departureDate(dayDate: "不正", departureTime: "08:30") == nil)
        #expect(ArrivalEstimator.departureDate(dayDate: "2026-09-01", departureTime: "08:30") != nil)
    }
}
