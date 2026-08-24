import Foundation

/// 自宅サーバ(g3plus)の trip-note API へアップロードするクライアント。
/// 認証は API_SHARED_SECRET の Bearer。接続情報は `Resources/ServerConfig.plist`
/// (gitignore 済み。雛形は ServerConfig.example.plist)から読む。
struct SyncClient: Sendable {
    let baseURL: URL
    let apiKey: String

    enum SyncClientError: LocalizedError {
        case serverError(statusCode: Int)

        var errorDescription: String? {
            switch self {
            case .serverError(let statusCode):
                return "サーバがエラーを返しました (HTTP \(statusCode))"
            }
        }
    }

    private struct SyncPayload: Encodable {
        let trips: [TripRecord]
        let days: [TripDayRecord]
        let checkpoints: [CheckpointRecord]
        let points: [LocationPointRecord]
    }

    /// snake_case の DTO を ISO8601(小数秒付き)の日付でエンコードする
    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(SyncDateFormat.string(from: date))
        }
        return encoder
    }()

    /// pull 応答の日付は小数秒あり/なしどちらの ISO8601 も受け付ける
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            guard let date = SyncDateFormat.date(from: string) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "ISO8601 として解釈できません: \(string)"
                )
            }
            return date
        }
        return decoder
    }()

    func send(
        trips: [TripRecord] = [],
        days: [TripDayRecord] = [],
        checkpoints: [CheckpointRecord] = [],
        points: [LocationPointRecord] = []
    ) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/sync"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try Self.encoder.encode(
            SyncPayload(trips: trips, days: days, checkpoints: checkpoints, points: points)
        )
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SyncClientError.serverError(statusCode: -1)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SyncClientError.serverError(statusCode: http.statusCode)
        }
    }

    /// プラン系の更新分を取得する。since は前回応答の serverTime(初回は nil で全件)
    func pull(since: String?) async throws -> PullResponse {
        guard
            var components = URLComponents(
                url: baseURL.appending(path: "api/sync/pull"),
                resolvingAgainstBaseURL: false
            )
        else { throw SyncClientError.serverError(statusCode: -1) }
        if let since {
            components.queryItems = [URLQueryItem(name: "since", value: since)]
        }
        guard let url = components.url else {
            throw SyncClientError.serverError(statusCode: -1)
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SyncClientError.serverError(statusCode: -1)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SyncClientError.serverError(statusCode: http.statusCode)
        }
        return try Self.decoder.decode(PullResponse.self, from: data)
    }

    /// メディアファイルを 1 件アップロードする。メタデータはクエリ、ボディはファイル。
    /// `upload(fromFile:)` なのでファイル全体をメモリに載せない
    func upload(media meta: MediaUploadMeta, fileURL: URL) async throws {
        guard
            var components = URLComponents(
                url: baseURL.appending(path: "api/media"),
                resolvingAgainstBaseURL: false
            )
        else { throw SyncClientError.serverError(statusCode: -1) }
        components.queryItems = meta.queryItems
        guard let url = components.url else {
            throw SyncClientError.serverError(statusCode: -1)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.upload(for: request, fromFile: fileURL)
        guard let http = response as? HTTPURLResponse else {
            throw SyncClientError.serverError(statusCode: -1)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SyncClientError.serverError(statusCode: http.statusCode)
        }
    }

    /// メディアを 1 件サーバから削除する。**404 は成功扱い**にする
    /// (アップロード前に削除した場合・再送の場合。これで削除は冪等になる)
    func delete(mediaId: UUID) async throws {
        guard
            var components = URLComponents(
                url: baseURL.appending(path: "api/media"),
                resolvingAgainstBaseURL: false
            )
        else { throw SyncClientError.serverError(statusCode: -1) }
        components.queryItems = [URLQueryItem(name: "id", value: mediaId.uuidString)]
        guard let url = components.url else {
            throw SyncClientError.serverError(statusCode: -1)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SyncClientError.serverError(statusCode: -1)
        }
        guard (200..<300).contains(http.statusCode) || http.statusCode == 404 else {
            throw SyncClientError.serverError(statusCode: http.statusCode)
        }
    }

    /// ServerConfig.plist から生成する。未設定・雛形のままなら nil
    static func fromBundle() -> SyncClient? {
        guard
            let url = Bundle.main.url(forResource: "ServerConfig", withExtension: "plist"),
            let data = try? Data(contentsOf: url),
            let plist = try? PropertyListSerialization.propertyList(from: data, format: nil),
            let dict = plist as? [String: Any],
            let urlString = dict["SERVER_URL"] as? String,
            let apiKey = dict["API_KEY"] as? String,
            let baseURL = URL(string: urlString),
            !urlString.contains("example.com"),
            !apiKey.isEmpty
        else { return nil }
        return SyncClient(baseURL: baseURL, apiKey: apiKey)
    }
}
