import Foundation

enum Geo {
    private static let earthRadiusMeters = 6_371_000.0

    /// 2点間の距離をメートルで返す(Haversine 公式)
    static func haversineDistance(
        lat1: Double, lng1: Double,
        lat2: Double, lng2: Double
    ) -> Double {
        let dLat = (lat2 - lat1).degreesToRadians
        let dLng = (lng2 - lng1).degreesToRadians
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1.degreesToRadians) * cos(lat2.degreesToRadians)
            * sin(dLng / 2) * sin(dLng / 2)
        return 2 * earthRadiusMeters * asin(sqrt(a))
    }

    /// 記録順に並んだ位置情報列の総移動距離をメートルで返す
    static func totalDistance(of points: [LocationPoint]) -> Double {
        totalDistance(coordinates: points.map { ($0.latitude, $0.longitude) })
    }

    /// 記録順に並んだ座標列の総移動距離をメートルで返す
    static func totalDistance(coordinates: [(latitude: Double, longitude: Double)]) -> Double {
        zip(coordinates, coordinates.dropFirst()).reduce(0) { sum, pair in
            sum + haversineDistance(
                lat1: pair.0.latitude, lng1: pair.0.longitude,
                lat2: pair.1.latitude, lng2: pair.1.longitude
            )
        }
    }
}

private extension Double {
    var degreesToRadians: Double { self * .pi / 180 }
}
