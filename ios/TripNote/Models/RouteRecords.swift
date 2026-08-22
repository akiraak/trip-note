import Foundation

/// 道路ルート解決(POST /api/route)のリクエスト/応答 DTO。
/// 日付フィールドが無いのでエンコード/デコードは素の JSONEncoder / JSONDecoder でよい

/// リクエスト: 解決したいレグ(隣接チェックポイント間)の列
struct RouteRequest: Encodable {
    struct Leg: Encodable {
        let from: RoutePoint
        let to: RoutePoint
    }

    let legs: [Leg]
}

/// 解決済みレグの道路形状。coordinates は GeoJSON LineString と同じ [lon, lat] のペア列
struct RouteLegPolyline: Decodable {
    let coordinates: [[Double]]
    let distanceM: Double
    let durationS: Double

    /// [lon, lat] のペア列を座標列にする(要素数が足りないペアは捨てる)
    var points: [RoutePoint] {
        coordinates.compactMap { pair in
            pair.count >= 2 ? RoutePoint(latitude: pair[1], longitude: pair[0]) : nil
        }
    }
}

/// 応答。リクエストと同順・同数で、解決できなかったレグは null
/// (クライアントは直線フォールバックで描く)
struct RouteResponse: Decodable {
    let legs: [RouteLegPolyline?]
}
