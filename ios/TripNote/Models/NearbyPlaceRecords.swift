import Foundation

/// POST /api/places/nearby のリクエスト(その日の経路の近くをカテゴリで探す)
struct NearbyPlacesRequest: Encodable {
    /// SearchCategory.rawValue
    let category: String
    /// その日の経路(前泊地 + 訪問順のチェックポイント)。座標ありが 1 つは必要
    let route: [DayRoutePlace]
}

/// 経路の近くの地点(OSM 由来)。有名どころ → 種類 → 経路から近い順に並んで返る
struct NearbyPlace: Decodable, Hashable, Identifiable {
    /// OSM の要素 id("node/123" 形式)
    let id: String
    let name: String
    /// OSM のタグ値(castle / museum …)
    let kind: String
    let kindLabel: String
    let latitude: Double
    let longitude: Double
    /// 経路上の最寄り地点までの直線距離
    let distanceM: Double
    let nearestRouteName: String
    let wikipediaUrl: String?
    let website: String?
}

struct NearbyPlacesResponse: Decodable {
    let places: [NearbyPlace]
}
