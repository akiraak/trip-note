import Foundation

/// AI 提案・検索補助(/api/ai/*)の呼び出し。接続先・認証は同期と同じ
/// (ServerConfig.plist の Bearer)なので SyncClient に相乗りする
extension SyncClient {
    /// サーバが {"error": "..."} で返す日本語メッセージをそのまま表示するためのエラー
    struct AIServerError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// AI 生成は数十秒〜数分かかるため、既定(60 秒)より長いタイムアウトにする
    private static let aiTimeout: TimeInterval = 300

    func suggestPlan(_ body: AIPlanRequest) async throws -> AIPlanSuggestion {
        try await postAI(path: "api/ai/plan", body: body)
    }

    func searchAssist(_ body: AISearchAssistRequest) async throws -> AISearchAssistSuggestion {
        try await postAI(path: "api/ai/search-assist", body: body)
    }

    private func postAI<Body: Encodable, Response: Decodable>(
        path: String,
        body: Body
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.timeoutInterval = Self.aiTimeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
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
