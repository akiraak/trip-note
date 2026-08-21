import Foundation
import Testing
@testable import TripNote

struct GeoTests {
    private func point(_ lat: Double, _ lng: Double) -> LocationPoint {
        LocationPoint(
            id: UUID(),
            tripId: UUID(),
            latitude: lat,
            longitude: lng,
            altitude: nil,
            accuracy: nil,
            recordedAt: Date(timeIntervalSince1970: 0)
        )
    }

    // 東京駅 (35.681236, 139.767125) - 新宿駅 (35.690921, 139.700258)
    private let tokyo = (lat: 35.681236, lng: 139.767125)
    private let shinjuku = (lat: 35.690921, lng: 139.700258)

    @Test func 同一地点は0を返す() {
        let d = Geo.haversineDistance(
            lat1: tokyo.lat, lng1: tokyo.lng,
            lat2: tokyo.lat, lng2: tokyo.lng
        )
        #expect(d == 0)
    }

    @Test func 東京駅と新宿駅の間はおよそ6_4km() {
        let d = Geo.haversineDistance(
            lat1: tokyo.lat, lng1: tokyo.lng,
            lat2: shinjuku.lat, lng2: shinjuku.lng
        )
        #expect(d > 6000)
        #expect(d < 6800)
    }

    @Test func 点が1つ以下なら総距離は0() {
        #expect(Geo.totalDistance(of: []) == 0)
        #expect(Geo.totalDistance(of: [point(tokyo.lat, tokyo.lng)]) == 0)
    }

    @Test func 各区間の距離を合計する() {
        let points = [
            point(tokyo.lat, tokyo.lng),
            point(shinjuku.lat, shinjuku.lng),
            point(tokyo.lat, tokyo.lng),
        ]
        let leg = Geo.haversineDistance(
            lat1: tokyo.lat, lng1: tokyo.lng,
            lat2: shinjuku.lat, lng2: shinjuku.lng
        )
        #expect(abs(Geo.totalDistance(of: points) - leg * 2) < 0.0001)
    }
}
