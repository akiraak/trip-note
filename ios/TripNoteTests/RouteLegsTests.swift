import Foundation
import Testing
@testable import TripNote

struct RouteLegsTests {
    private let tokyo = RoutePoint(latitude: 35.681236, longitude: 139.767125)
    private let matsumoto = RoutePoint(latitude: 36.238057, longitude: 137.971870)
    private let kamikochi = RoutePoint(latitude: 36.145139, longitude: 137.550171)
    private let takayama = RoutePoint(latitude: 36.146082, longitude: 137.252212)

    @Test func 座標列を隣接ペアのレグ列にする() {
        let legs = RouteLegBuilder.legs(through: [tokyo, matsumoto, kamikochi])
        #expect(legs.count == 2)
        #expect(legs[0].from == tokyo)
        #expect(legs[0].to == matsumoto)
        #expect(legs[1].from == matsumoto)
        #expect(legs[1].to == kamikochi)
    }

    @Test func 起点があれば前泊地からの先頭レグが付く() {
        let legs = RouteLegBuilder.legs(routeStart: tokyo, through: [matsumoto, kamikochi])
        #expect(legs.count == 2)
        #expect(legs[0].from == tokyo)
        #expect(legs[0].to == matsumoto)
        // 起点 + チェックポイント 1 つでもレグになる(前泊地 → 唯一の目的地)
        let single = RouteLegBuilder.legs(routeStart: tokyo, through: [matsumoto])
        #expect(single == [RouteLeg(from: tokyo, to: matsumoto)])
    }

    @Test func 座標が1点以下ならレグなし() {
        #expect(RouteLegBuilder.legs(through: []).isEmpty)
        #expect(RouteLegBuilder.legs(through: [tokyo]).isEmpty)
        #expect(RouteLegBuilder.legs(routeStart: tokyo, through: []).isEmpty)
    }

    @Test func キーは小数4桁で丸めた座標ペア() {
        let leg = RouteLeg(from: tokyo, to: matsumoto)
        #expect(leg.key == "35.6812,139.7671>36.2381,137.9719")
    }

    @Test func 丸め粒度で同一地点になる隣接レグは除外する() {
        // 小数 5 桁目の差(約 1m)は同一地点扱い
        let nudged = RoutePoint(
            latitude: tokyo.latitude + 0.00001,
            longitude: tokyo.longitude
        )
        let legs = RouteLegBuilder.legs(through: [tokyo, nudged, matsumoto])
        #expect(legs.count == 1)
        #expect(legs[0].key == RouteLeg(from: tokyo, to: matsumoto).key)
    }

    @Test func 途中挿入では変わった区間のキーだけが変わる() {
        let before = RouteLegBuilder.legs(routeStart: tokyo, through: [matsumoto, takayama])
        // 松本 → 高山の途中に上高地を挿入
        let after = RouteLegBuilder.legs(
            routeStart: tokyo,
            through: [matsumoto, kamikochi, takayama]
        )
        #expect(after.count == 3)
        // 前泊地レグ(東京 → 松本)は変わらない = キャッシュがそのまま効く
        #expect(after[0].key == before[0].key)
        // 松本 → 高山のレグは消え、松本 → 上高地・上高地 → 高山に置き換わる
        #expect(!after.map(\.key).contains(before[1].key))
        #expect(after[1] == RouteLeg(from: matsumoto, to: kamikochi))
        #expect(after[2] == RouteLeg(from: kamikochi, to: takayama))
    }

    @Test func 並び替えにはレグ列が追従する() {
        let legs = RouteLegBuilder.legs(through: [matsumoto, takayama, kamikochi])
        #expect(legs == [
            RouteLeg(from: matsumoto, to: takayama),
            RouteLeg(from: takayama, to: kamikochi),
        ])
    }

    // MARK: - 日毎距離の合算(RouteLegDistance)

    @Test func 全レグ解決済みなら道路距離の合計() {
        let legs = RouteLegBuilder.legs(through: [tokyo, matsumoto, kamikochi])
        let resolved = [
            legs[0].key: ResolvedRouteLeg(
                points: [tokyo, matsumoto], distanceM: 225_000, durationS: 10_000
            ),
            legs[1].key: ResolvedRouteLeg(
                points: [matsumoto, kamikochi], distanceM: 40_000, durationS: 3_600
            ),
        ]
        #expect(RouteLegDistance.totalMeters(legs: legs, resolved: resolved) == 265_000)
    }

    @Test func 未解決レグは直線距離でフォールバックする() {
        let legs = RouteLegBuilder.legs(through: [tokyo, matsumoto, kamikochi])
        let resolved = [
            legs[0].key: ResolvedRouteLeg(
                points: [tokyo, matsumoto], distanceM: 225_000, durationS: 10_000
            ),
        ]
        let straight = Geo.haversineDistance(
            lat1: matsumoto.latitude, lng1: matsumoto.longitude,
            lat2: kamikochi.latitude, lng2: kamikochi.longitude
        )
        #expect(
            RouteLegDistance.totalMeters(legs: legs, resolved: resolved) == 225_000 + straight
        )
    }

    @Test func 全レグ未解決なら直線距離の合計() {
        let legs = RouteLegBuilder.legs(through: [tokyo, matsumoto])
        let straight = Geo.haversineDistance(
            lat1: tokyo.latitude, lng1: tokyo.longitude,
            lat2: matsumoto.latitude, lng2: matsumoto.longitude
        )
        #expect(RouteLegDistance.totalMeters(legs: legs, resolved: [:]) == straight)
    }

    @Test func レグなしなら距離0() {
        #expect(RouteLegDistance.totalMeters(legs: [], resolved: [:]) == 0)
    }

    @Test func 同一地点レグは距離0扱い() {
        let degenerate = RouteLeg(from: tokyo, to: tokyo)
        #expect(RouteLegDistance.totalMeters(legs: [degenerate], resolved: [:]) == 0)
    }
}
