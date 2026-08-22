import Foundation

/// 旅行の状態。status カラムは持たず started_at / ended_at から導出する
/// (同期の競合対象を減らすため)
enum TripStatus {
    /// 未出発(started_at == nil)
    case planning
    /// 進行中(started_at あり・ended_at == nil)。記録中とは限らない
    case inProgress
    /// 終了(ended_at あり)
    case finished
}

/// 移動手段。旅行単位で持ち、AI 行程提案の入力に使う。
/// サーバへは rawValue の文字列で同期する(TripEntity.transport は String? のままにして
/// 未知の値も落とさず保持する)
enum Transport: String, Codable, CaseIterable {
    case car
    case train
    case walk
    case bicycle
    case mixed
}

struct Trip: Codable, Identifiable, Hashable {
    let id: UUID
    var title: String
    var startedAt: Date?
    var endedAt: Date?
    var transport: String?
    var deletedAt: Date?
    let createdAt: Date
}

/// チェックポイントの種別。出発地は 1 日目の departure、到着予定地は最終日の
/// destination として表現する(Trip にはカラムを持たない)
enum CheckpointType: String, Codable, CaseIterable {
    case departure
    case destination
    case sightseeing
    case cafe
    case restaurant
    case lodging
    case other
}

struct TripDay: Codable, Identifiable, Hashable {
    let id: UUID
    let tripId: UUID
    /// YYYY-MM-DD
    var date: String
    var title: String?
    var note: String?
    var updatedAt: Date
    var deletedAt: Date?
}

struct Checkpoint: Codable, Identifiable, Hashable {
    let id: UUID
    let tripId: UUID
    var tripDayId: UUID
    var type: CheckpointType
    var name: String
    var latitude: Double?
    var longitude: Double?
    var plannedTime: Date?
    var note: String?
    var sortOrder: Int
    var updatedAt: Date
    var deletedAt: Date?
}

struct LocationPoint: Codable, Identifiable, Hashable {
    let id: UUID
    let tripId: UUID
    let latitude: Double
    let longitude: Double
    let altitude: Double?
    let accuracy: Double?
    let recordedAt: Date
}

enum MediaType: String, Codable {
    case photo
    case video
}

struct Media: Codable, Identifiable, Hashable {
    let id: UUID
    let tripId: UUID
    let locationPointId: UUID?
    let type: MediaType
    let storagePath: String
    let takenAt: Date
}
