import Foundation

/// サーバ API と揃えた ISO8601(小数秒付き)の日付文字列
enum SyncDateFormat {
    static func string(from date: Date) -> String {
        let style = Date.ISO8601FormatStyle()
            .year().month().day()
            .dateTimeSeparator(.standard)
            .time(includingFractionalSeconds: true)
            .timeZone(separator: .omitted)
        return date.formatted(style)
    }
}

/// Supabase へアップロードする行(snake_case カラムに合わせた DTO)。
/// PostgREST の一括 upsert は行ごとにキーが揃っている必要があるため、
/// nil のカラムも省略せず明示的に null としてエンコードする。
struct TripRecord: Encodable, Sendable {
    let id: UUID
    let title: String
    let startedAt: Date
    let endedAt: Date?

    init(_ trip: TripEntity) {
        id = trip.id
        title = trip.title
        startedAt = trip.startedAt
        endedAt = trip.endedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case startedAt = "started_at"
        case endedAt = "ended_at"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(endedAt, forKey: .endedAt)
    }
}

struct LocationPointRecord: Encodable, Sendable {
    let id: UUID
    let tripId: UUID
    let latitude: Double
    let longitude: Double
    let altitude: Double?
    let accuracy: Double?
    let recordedAt: Date

    /// trip との関連が切れている点は同期できないため nil を返す
    init?(_ point: LocationPointEntity) {
        guard let trip = point.trip else { return nil }
        id = point.id
        tripId = trip.id
        latitude = point.latitude
        longitude = point.longitude
        altitude = point.altitude
        accuracy = point.horizontalAccuracy
        recordedAt = point.recordedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case latitude
        case longitude
        case altitude
        case accuracy
        case recordedAt = "recorded_at"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(tripId, forKey: .tripId)
        try container.encode(latitude, forKey: .latitude)
        try container.encode(longitude, forKey: .longitude)
        try container.encode(altitude, forKey: .altitude)
        try container.encode(accuracy, forKey: .accuracy)
        try container.encode(recordedAt, forKey: .recordedAt)
    }
}

/// `POST /api/media` のクエリパラメータになるメタデータ。
/// ボディはファイルバイナリそのものなので、この構造体は JSON にはならない。
struct MediaUploadMeta: Sendable {
    let id: UUID
    let tripId: UUID
    let locationPointId: UUID?
    let type: String
    let takenAt: Date
    let ext: String

    /// trip との関連が切れたメディアは同期できないため nil を返す
    init?(_ media: MediaEntity) {
        guard let trip = media.trip else { return nil }
        id = media.id
        tripId = trip.id
        locationPointId = media.locationPoint?.id
        type = media.typeRawValue
        takenAt = media.takenAt
        ext = (media.fileName as NSString).pathExtension
    }

    var queryItems: [URLQueryItem] {
        var items = [
            URLQueryItem(name: "id", value: id.uuidString),
            URLQueryItem(name: "trip_id", value: tripId.uuidString),
            URLQueryItem(name: "type", value: type),
            URLQueryItem(name: "taken_at", value: SyncDateFormat.string(from: takenAt)),
            URLQueryItem(name: "ext", value: ext),
        ]
        if let locationPointId {
            items.append(URLQueryItem(name: "location_point_id", value: locationPointId.uuidString))
        }
        return items
    }
}
