import Foundation

/// 道路ルート(/api/route)の呼び出し。接続先・認証は同期と同じ
/// (ServerConfig.plist の Bearer)なので SyncClient に相乗りする。
/// 取得はレグ(隣接チェックポイント間)単位で、アプリ内メモリキャッシュ →
/// サーバの route_legs キャッシュ → OSRM の三段。解決できないレグは結果に
/// 含めない(呼び出し側が従来どおりの直線で描く)

/// 解決済みレグのメモリキャッシュ。List のスクロールでミニ地図が再表示される
/// たびに再リクエストしないためのもの(道路形状は滅多に変わらないので無期限)
actor RouteLegCache {
    static let shared = RouteLegCache()

    private var store: [String: ResolvedRouteLeg] = [:]

    func legs(for keys: [String]) -> [String: ResolvedRouteLeg] {
        var found: [String: ResolvedRouteLeg] = [:]
        for key in keys {
            if let leg = store[key] {
                found[key] = leg
            }
        }
        return found
    }

    func insert(_ legs: [String: ResolvedRouteLeg]) {
        store.merge(legs) { _, new in new }
    }
}

extension SyncClient {
    /// 1 リクエストのレグ数上限(サーバ側 MAX_LEGS_PER_REQUEST と同じ)
    private static var maxLegsPerRequest: Int { 50 }

    /// レグ列を解決結果(レグキー → 道路形状 + 距離・所要時間)へ解決する。
    /// 通信エラー・未解決レグは辞書に含めず、throw もしない(直線フォールバック前提)
    func resolvedLegs(for legs: [RouteLeg]) async -> [String: ResolvedRouteLeg] {
        // 同一キー(丸め粒度で同じ区間)はまとめて 1 回だけ問い合わせる
        var unique: [RouteLeg] = []
        var seen = Set<String>()
        for leg in legs where seen.insert(leg.key).inserted {
            unique.append(leg)
        }
        var resolved = await RouteLegCache.shared.legs(for: unique.map(\.key))
        let misses = unique.filter { resolved[$0.key] == nil }
        guard !misses.isEmpty else { return resolved }
        var fetched: [String: ResolvedRouteLeg] = [:]
        for start in stride(from: 0, to: misses.count, by: Self.maxLegsPerRequest) {
            let chunk = misses[start..<min(start + Self.maxLegsPerRequest, misses.count)]
            let request = RouteRequest(legs: chunk.map { .init(from: $0.from, to: $0.to) })
            guard let response = try? await postRoute(request) else { continue }
            for (leg, polyline) in zip(chunk, response.legs) {
                guard let resolvedLeg = polyline?.resolved else { continue }
                fetched[leg.key] = resolvedLeg
            }
        }
        guard !fetched.isEmpty else { return resolved }
        await RouteLegCache.shared.insert(fetched)
        resolved.merge(fetched) { _, new in new }
        return resolved
    }

    private func postRoute(_ body: RouteRequest) async throws -> RouteResponse {
        var request = URLRequest(url: baseURL.appending(path: "api/route"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard
            let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode)
        else {
            throw SyncClientError.serverError(
                statusCode: (response as? HTTPURLResponse)?.statusCode ?? -1
            )
        }
        return try JSONDecoder().decode(RouteResponse.self, from: data)
    }
}
