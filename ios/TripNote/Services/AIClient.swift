import Foundation

/// AI 提案・検索補助(/api/ai/*)の呼び出し。接続先・認証は同期と同じ
/// (ServerConfig.plist の Bearer)なので SyncClient に相乗りする。
/// plan / trip-outline の生成は数十秒〜数分かかり、接続を張りっぱなしにすると
/// アプリ切替で iOS がソケットを切って "The network connection was lost" になる。
/// そのためジョブ登録(POST /api/ai/jobs)→ ポーリング(GET /api/ai/jobs/[id])で
/// 結果を受け取る。search-assist は数秒で返るので従来の同期 POST のまま
extension SyncClient {
    /// サーバが {"error": "..."} で返す日本語メッセージをそのまま表示するためのエラー
    struct AIServerError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// search-assist(同期 POST)は生成待ちを含むため既定(60 秒)より長くする
    private static let aiTimeout: TimeInterval = 300
    /// ジョブ登録・ポーリングは即応答なので短くてよい
    private static let aiJobRequestTimeout: TimeInterval = 30
    private static let aiJobPollInterval: Duration = .seconds(3)
    /// ジョブ全体の待ち時間上限(サーバも 10 分更新の無いジョブは failed に落とす)
    private static let aiJobDeadline: TimeInterval = 600

    func suggestPlan(_ body: AIPlanRequest) async throws -> AIPlanSuggestion {
        try await runAIJob(kind: "plan", input: body)
    }

    func suggestTripOutline(_ body: AITripOutlineRequest) async throws -> AITripOutlineSuggestion {
        try await runAIJob(kind: "trip_outline", input: body)
    }

    func searchAssist(_ body: AISearchAssistRequest) async throws -> AISearchAssistSuggestion {
        try await postAI(path: "api/ai/search-assist", body: body, timeout: Self.aiTimeout)
    }

    /// Overpass の応答待ち(サーバ側は 25 秒でクエリを打ち切る)
    private static let nearbyTimeout: TimeInterval = 60

    /// その日の経路の近くをカテゴリ(観光地など)で探す(AI ではないが Bearer・
    /// エラー形式が同じなので同じ送受信に相乗りする)
    func nearbyPlaces(category: SearchCategory, route: [DayRoutePlace]) async throws -> [NearbyPlace] {
        let response: NearbyPlacesResponse = try await postAI(
            path: "api/places/nearby",
            body: NearbyPlacesRequest(category: category.rawValue, route: route),
            timeout: Self.nearbyTimeout
        )
        return response.places
    }

    /// ジョブを登録して完了までポーリングする。アプリ切替の瞬間などの一時的な
    /// 通信エラーは無視して続行し(登録は id 冪等なので再送も安全)、サーバが
    /// 明示的にエラーを返したとき(バリデーション・生成失敗など)だけ即失敗する
    private func runAIJob<Input: Encodable, Output: Decodable>(
        kind: String,
        input: Input
    ) async throws -> Output {
        let create = AIJobCreateRequest(id: UUID().uuidString.lowercased(), kind: kind, input: input)
        let deadline = Date().addingTimeInterval(Self.aiJobDeadline)
        var created = false
        while Date() < deadline {
            do {
                if !created {
                    let _: AIJobCreated = try await postAI(
                        path: "api/ai/jobs", body: create, timeout: Self.aiJobRequestTimeout
                    )
                    created = true
                }
                let job: AIJobStatusResponse<Output> =
                    try await getAI(path: "api/ai/jobs/\(create.id)")
                switch job.status {
                case "succeeded":
                    guard let result = job.result else {
                        throw AIServerError(message: "AI 生成の結果を読み取れませんでした")
                    }
                    return result
                case "failed":
                    throw AIServerError(message: job.error ?? "AI 生成に失敗しました")
                default:
                    break
                }
            } catch let error as AIServerError {
                throw error
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // 一時的な通信エラー(アプリ切替・電波断など)。次のポーリングで再試行
            }
            try await Task.sleep(for: Self.aiJobPollInterval)
        }
        throw AIServerError(message: "AI 生成が時間内に終わりませんでした。もう一度お試しください")
    }

    private func postAI<Body: Encodable, Response: Decodable>(
        path: String,
        body: Body,
        timeout: TimeInterval
    ) async throws -> Response {
        var request = aiRequest(path: path, timeout: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await sendAI(request)
    }

    private func getAI<Response: Decodable>(path: String) async throws -> Response {
        try await sendAI(aiRequest(path: path, timeout: Self.aiJobRequestTimeout))
    }

    private func aiRequest(path: String, timeout: TimeInterval) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.timeoutInterval = timeout
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func sendAI<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SyncClientError.serverError(statusCode: -1)
        }
        guard (200..<300).contains(http.statusCode) else {
            if
                let payload = try? JSONDecoder().decode([String: String].self, from: data),
                let message = payload["error"]
            {
                throw AIServerError(message: message)
            }
            throw SyncClientError.serverError(statusCode: http.statusCode)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
