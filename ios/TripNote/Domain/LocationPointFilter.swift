import Foundation

/// CoreLocation から届いた 1 サンプル。Sendable にして delegate スレッドから MainActor へ安全に渡す
struct LocationSample: Sendable, Equatable {
    var latitude: Double
    var longitude: Double
    var altitude: Double?
    var horizontalAccuracy: Double?
    var recordedAt: Date
}

/// 記録するサンプルの選別ルール(純粋ロジック)
enum LocationPointFilter {
    /// これを超える水平精度(誤差)のサンプルは破棄する
    static let maxHorizontalAccuracyMeters = 50.0
    /// 直前の記録点からの移動がこれ未満なら間引く
    static let minDistanceMeters = 5.0

    static func shouldRecord(_ sample: LocationSample, after last: LocationSample?) -> Bool {
        if let accuracy = sample.horizontalAccuracy {
            // 負値は無効なサンプル
            guard accuracy >= 0, accuracy <= maxHorizontalAccuracyMeters else { return false }
        }
        guard let last else { return true }
        guard sample.recordedAt > last.recordedAt else { return false }
        let distance = Geo.haversineDistance(
            lat1: last.latitude, lng1: last.longitude,
            lat2: sample.latitude, lng2: sample.longitude
        )
        return distance >= minDistanceMeters
    }
}
