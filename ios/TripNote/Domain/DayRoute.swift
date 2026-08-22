import Foundation

/// その日の経路上の 1 地点(前泊地 or チェックポイント)。
/// 地図検索の範囲ヒントと AI 検索補助の文脈に使う。座標なし CP も名前だけ含める
struct DayRoutePlace: Hashable, Encodable {
    let name: String
    let latitude: Double?
    let longitude: Double?

    var routePoint: RoutePoint? {
        guard let latitude, let longitude else { return nil }
        return RoutePoint(latitude: latitude, longitude: longitude)
    }
}

/// 地図検索に渡す範囲(中心 + 一辺の長さ)。MapKit 非依存
struct SearchRegion: Equatable {
    let center: RoutePoint
    let spanMeters: Double
}

enum DayRoute {
    /// 検索範囲の一辺の下限。経路が短い日(市内観光など)でも周辺の候補が拾えるように
    static let minimumSpanMeters = 20_000.0
    /// 経路の外接矩形に対する余白(経路の少し外側まで候補に入れる)
    static let spanScale = 1.5

    /// 前日までの最後の座標ありチェックポイント(前泊地など)。経路の起点になる
    static func anchor(before index: Int, in days: [TripDayEntity]) -> CheckpointEntity? {
        for day in days[..<index].reversed() {
            if let last = day.sortedCheckpoints.last(where: { $0.latitude != nil && $0.longitude != nil }) {
                return last
            }
        }
        return nil
    }

    /// その日の経路(前泊地 + 訪問順のチェックポイント)。
    /// 座標なし CP も名前だけ含める(AI 補助には行程の文脈として有用)
    static func places(for day: TripDayEntity) -> [DayRoutePlace] {
        var places: [DayRoutePlace] = []
        if let trip = day.trip,
           let index = trip.sortedDays.firstIndex(where: { $0.id == day.id }),
           let anchor = anchor(before: index, in: trip.sortedDays) {
            places.append(place(of: anchor))
        }
        places += day.sortedCheckpoints.map(place(of:))
        return places
    }

    /// 経路の座標あり地点を囲む正方形の検索範囲。座標が 1 つも無ければ nil
    static func searchRegion(for places: [DayRoutePlace]) -> SearchRegion? {
        let points = places.compactMap(\.routePoint)
        guard
            let minLat = points.map(\.latitude).min(),
            let maxLat = points.map(\.latitude).max(),
            let minLng = points.map(\.longitude).min(),
            let maxLng = points.map(\.longitude).max()
        else { return nil }
        let center = RoutePoint(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2
        )
        // 外接矩形の縦横を中心の緯度で測り、長い方に余白を掛ける
        let height = Geo.haversineDistance(
            lat1: minLat, lng1: center.longitude, lat2: maxLat, lng2: center.longitude
        )
        let width = Geo.haversineDistance(
            lat1: center.latitude, lng1: minLng, lat2: center.latitude, lng2: maxLng
        )
        let span = max(max(width, height) * spanScale, minimumSpanMeters)
        return SearchRegion(center: center, spanMeters: span)
    }

    private static func place(of checkpoint: CheckpointEntity) -> DayRoutePlace {
        DayRoutePlace(
            name: checkpoint.name,
            latitude: checkpoint.latitude,
            longitude: checkpoint.longitude
        )
    }
}
