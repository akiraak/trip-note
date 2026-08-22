import Foundation

/// Google Maps へ座標を渡す URL の生成。
/// 公式のクロスプラットフォーム形式(Maps URLs)のユニバーサルリンクなので、
/// Google Maps アプリがあればアプリ、無ければブラウザで開く
/// (comgooglemaps:// スキームと LSApplicationQueriesSchemes は不要)
enum GoogleMapsLink {
    /// 指定座標を Google Maps で表示する URL。
    /// 名前で検索すると同名の別地点に飛び得るため、クエリは座標のみにする
    static func searchURL(latitude: Double, longitude: Double) -> URL {
        // 小数 6 桁(約 0.1 m)あれば十分。String(format:) は locale 非依存で "." 区切り
        let query = String(format: "%.6f,%.6f", latitude, longitude)
        var components = URLComponents(string: "https://www.google.com/maps/search/")!
        components.queryItems = [
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "query", value: query),
        ]
        return components.url!
    }
}
