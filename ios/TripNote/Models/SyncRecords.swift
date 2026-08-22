import Foundation

/// サーバ API と揃えた ISO8601(小数秒付き)の日付文字列
enum SyncDateFormat {
    private static var style: Date.ISO8601FormatStyle {
        Date.ISO8601FormatStyle()
            .year().month().day()
            .dateTimeSeparator(.standard)
            .time(includingFractionalSeconds: true)
            .timeZone(separator: .omitted)
    }

    static func string(from date: Date) -> String {
        date.formatted(style)
    }

    /// pull 応答のパース用。小数秒なしの ISO8601 も受け付ける
    static func date(from string: String) -> Date? {
        (try? style.parse(string))
            ?? (try? Date.ISO8601FormatStyle().parse(string))
    }
}

/// Supabase へアップロードする行(snake_case カラムに合わせた DTO)。
/// PostgREST の一括 upsert は行ごとにキーが揃っている必要があるため、
/// nil のカラムも省略せず明示的に null としてエンコードする。
struct TripRecord: Encodable, Sendable {
    let id: UUID
    let title: String
    let startedAt: Date?
    let endedAt: Date?
    let transport: String?
    let departureAt: Date?
    let destination: String?
    let updatedAt: Date
    let deletedAt: Date?

    init(_ trip: TripEntity) {
        id = trip.id
        title = trip.title
        startedAt = trip.startedAt
        endedAt = trip.endedAt
        transport = trip.transport
        departureAt = trip.departureAt
        destination = trip.destination
        updatedAt = trip.updatedAt
        deletedAt = trip.deletedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case transport
        case departureAt = "departure_at"
        case destination
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(endedAt, forKey: .endedAt)
        try container.encode(transport, forKey: .transport)
        try container.encode(departureAt, forKey: .departureAt)
        try container.encode(destination, forKey: .destination)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(deletedAt, forKey: .deletedAt)
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

/// プランの 1 日の同期 DTO(双方向同期。updated_at は編集時刻 = LWW の基準)
struct TripDayRecord: Encodable, Sendable {
    let id: UUID
    let tripId: UUID
    let date: String
    let title: String?
    let note: String?
    let updatedAt: Date
    let deletedAt: Date?

    /// trip との関連が切れている日は同期できないため nil を返す
    init?(_ day: TripDayEntity) {
        guard let trip = day.trip else { return nil }
        id = day.id
        tripId = trip.id
        date = day.date
        title = day.title
        note = day.note
        updatedAt = day.updatedAt
        deletedAt = day.deletedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case date
        case title
        case note
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(tripId, forKey: .tripId)
        try container.encode(date, forKey: .date)
        try container.encode(title, forKey: .title)
        try container.encode(note, forKey: .note)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(deletedAt, forKey: .deletedAt)
    }
}

/// チェックポイントの同期 DTO(双方向同期。updated_at は編集時刻 = LWW の基準)
struct CheckpointRecord: Encodable, Sendable {
    let id: UUID
    let tripId: UUID
    let tripDayId: UUID
    let type: String
    let name: String
    let latitude: Double?
    let longitude: Double?
    let plannedTime: Date?
    let note: String?
    let sortOrder: Int
    let updatedAt: Date
    let deletedAt: Date?

    /// trip / trip_day との関連が切れている点は同期できないため nil を返す
    init?(_ checkpoint: CheckpointEntity) {
        guard let trip = checkpoint.trip, let day = checkpoint.tripDay else { return nil }
        id = checkpoint.id
        tripId = trip.id
        tripDayId = day.id
        type = checkpoint.typeRawValue
        name = checkpoint.name
        latitude = checkpoint.latitude
        longitude = checkpoint.longitude
        plannedTime = checkpoint.plannedTime
        note = checkpoint.note
        sortOrder = checkpoint.sortOrder
        updatedAt = checkpoint.updatedAt
        deletedAt = checkpoint.deletedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case tripDayId = "trip_day_id"
        case type
        case name
        case latitude
        case longitude
        case plannedTime = "planned_time"
        case note
        case sortOrder = "sort_order"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(tripId, forKey: .tripId)
        try container.encode(tripDayId, forKey: .tripDayId)
        try container.encode(type, forKey: .type)
        try container.encode(name, forKey: .name)
        try container.encode(latitude, forKey: .latitude)
        try container.encode(longitude, forKey: .longitude)
        try container.encode(plannedTime, forKey: .plannedTime)
        try container.encode(note, forKey: .note)
        try container.encode(sortOrder, forKey: .sortOrder)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(deletedAt, forKey: .deletedAt)
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
