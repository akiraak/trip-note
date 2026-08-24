import Foundation

/// `GET /api/sync/pull` の応答。プラン系(trips / trip_days / checkpoints)の
/// 更新分(tombstone 含む)と serverTime を受け取る。
/// serverTime は次回 pull の since にそのまま渡すため文字列のまま保持する
struct PullResponse: Decodable, Sendable {
    let serverTime: String
    let trips: [TripPullRecord]
    let days: [TripDayPullRecord]
    let checkpoints: [CheckpointPullRecord]
    /// 削除されたメディア(tombstone のみ)。メディア本体は一方向アップロードなので
    /// pull で配るのは削除だけ。旧サーバは返さないため省略可
    let media: [MediaPullRecord]?

    /// 削除されたメディア(旧サーバの応答でも空配列として扱えるようにする)
    var deletedMedia: [MediaPullRecord] { media ?? [] }
}

/// 削除されたメディア。Web で消したものを iOS のローカルからも消すために使う
struct MediaPullRecord: Decodable, Sendable {
    let id: UUID
    let tripId: UUID
    let deletedAt: Date

    private enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case deletedAt = "deleted_at"
    }
}

struct TripPullRecord: Decodable, Sendable {
    let id: UUID
    let title: String
    let startedAt: Date?
    let endedAt: Date?
    let transport: String?
    let departureAt: Date?
    let destination: String?
    let updatedAt: Date
    let deletedAt: Date?

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
}

struct TripDayPullRecord: Decodable, Sendable {
    let id: UUID
    let tripId: UUID
    /// YYYY-MM-DD
    let date: String
    let title: String?
    let note: String?
    /// 前泊地を出発する時刻 "HH:MM"(旧サーバの応答に無ければ nil)
    let departureTime: String?
    let updatedAt: Date
    let deletedAt: Date?

    private enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case date
        case title
        case note
        case departureTime = "departure_time"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
    }
}

struct CheckpointPullRecord: Decodable, Sendable {
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
}
