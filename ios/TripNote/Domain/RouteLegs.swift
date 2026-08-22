import Foundation

/// 日毎プランのルートを「隣接チェックポイント間のレグ(区間)」の集合として扱うための型と組み立て。
/// レグ単位にすることで、途中へのチェックポイント追加・並び替え・座標の具体化(検索で上書き)
/// では変わった区間だけがキー違いになり、メモリ/サーバのキャッシュが自然に効く。

/// レグの端点。Domain を MapKit 非依存に保つための最小の座標型
struct RoutePoint: Hashable, Codable, Sendable {
    let latitude: Double
    let longitude: Double
}

/// 隣接チェックポイント間のレグ。key は座標を小数 4 桁(約 10m 粒度)で丸めた
/// "lat,lon>lat,lon"(サーバの route_legs キャッシュと同じ規約)
struct RouteLeg: Hashable, Sendable {
    let from: RoutePoint
    let to: RoutePoint

    var key: String {
        "\(Self.rounded(from.latitude)),\(Self.rounded(from.longitude))>"
            + "\(Self.rounded(to.latitude)),\(Self.rounded(to.longitude))"
    }

    /// 丸め粒度で同一地点になるレグ(距離ほぼ 0)。リクエストする意味が無い
    var isDegenerate: Bool {
        Self.rounded(from.latitude) == Self.rounded(to.latitude)
            && Self.rounded(from.longitude) == Self.rounded(to.longitude)
    }

    private static func rounded(_ value: Double) -> String {
        String(format: "%.4f", value)
    }
}

enum RouteLegBuilder {
    /// 訪問順の座標列(+前泊地などの起点)をレグ列にする。
    /// 座標なしのチェックポイントは呼び出し側で除外済みの前提(現状の直線描画と同じ)。
    /// 丸め粒度で同一地点になる隣接ペアのレグは作らない
    static func legs(routeStart: RoutePoint? = nil, through points: [RoutePoint]) -> [RouteLeg] {
        var route = points
        if let routeStart {
            route.insert(routeStart, at: 0)
        }
        return zip(route, route.dropFirst())
            .map { RouteLeg(from: $0, to: $1) }
            .filter { !$0.isDegenerate }
    }
}
