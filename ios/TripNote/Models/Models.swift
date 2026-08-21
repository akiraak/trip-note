import Foundation

struct Trip: Codable, Identifiable, Hashable {
    let id: UUID
    var title: String
    var startedAt: Date
    var endedAt: Date?
    let createdAt: Date
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
