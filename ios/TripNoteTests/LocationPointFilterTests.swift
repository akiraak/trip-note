import Foundation
import Testing
@testable import TripNote

struct LocationPointFilterTests {
    private func sample(
        lat: Double = 35.0,
        lng: Double = 139.0,
        accuracy: Double? = 10,
        secondsSinceEpoch: TimeInterval = 0
    ) -> LocationSample {
        LocationSample(
            latitude: lat,
            longitude: lng,
            altitude: nil,
            horizontalAccuracy: accuracy,
            recordedAt: Date(timeIntervalSince1970: secondsSinceEpoch)
        )
    }

    @Test func 最初のサンプルは記録する() {
        #expect(LocationPointFilter.shouldRecord(sample(), after: nil))
    }

    @Test func 精度が閾値を超えるサンプルは破棄する() {
        let bad = sample(accuracy: LocationPointFilter.maxHorizontalAccuracyMeters + 1)
        #expect(!LocationPointFilter.shouldRecord(bad, after: nil))
    }

    @Test func 負の精度は無効なサンプルとして破棄する() {
        #expect(!LocationPointFilter.shouldRecord(sample(accuracy: -1), after: nil))
    }

    @Test func 精度不明はモデル上許容して記録する() {
        #expect(LocationPointFilter.shouldRecord(sample(accuracy: nil), after: nil))
    }

    @Test func 直前の点から5m未満の移動は間引く() {
        let last = sample(secondsSinceEpoch: 0)
        // 緯度 +0.00002 度 ≒ 2.2m
        let near = sample(lat: 35.00002, secondsSinceEpoch: 10)
        #expect(!LocationPointFilter.shouldRecord(near, after: last))
    }

    @Test func 直前の点から5m以上の移動は記録する() {
        let last = sample(secondsSinceEpoch: 0)
        // 緯度 +0.0001 度 ≒ 11.1m
        let far = sample(lat: 35.0001, secondsSinceEpoch: 10)
        #expect(LocationPointFilter.shouldRecord(far, after: last))
    }

    @Test func 時刻が逆行するサンプルは破棄する() {
        let last = sample(secondsSinceEpoch: 100)
        let stale = sample(lat: 35.01, secondsSinceEpoch: 50)
        #expect(!LocationPointFilter.shouldRecord(stale, after: last))
    }
}
