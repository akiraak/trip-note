import Foundation
import SwiftData

@Model
final class TripEntity {
    @Attribute(.unique) var id: UUID
    var title: String
    var startedAt: Date
    var endedAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \LocationPointEntity.trip)
    var points: [LocationPointEntity] = []

    init(id: UUID = UUID(), title: String, startedAt: Date = Date(), endedAt: Date? = nil) {
        self.id = id
        self.title = title
        self.startedAt = startedAt
        self.endedAt = endedAt
    }

    var isActive: Bool { endedAt == nil }

    var sortedPoints: [LocationPointEntity] {
        points.sorted { $0.recordedAt < $1.recordedAt }
    }

    var totalDistanceMeters: Double {
        Geo.totalDistance(coordinates: sortedPoints.map { ($0.latitude, $0.longitude) })
    }
}

@Model
final class LocationPointEntity {
    @Attribute(.unique) var id: UUID
    var latitude: Double
    var longitude: Double
    var altitude: Double?
    var horizontalAccuracy: Double?
    var recordedAt: Date
    var trip: TripEntity?

    init(
        id: UUID = UUID(),
        latitude: Double,
        longitude: Double,
        altitude: Double? = nil,
        horizontalAccuracy: Double? = nil,
        recordedAt: Date,
        trip: TripEntity? = nil
    ) {
        self.id = id
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.horizontalAccuracy = horizontalAccuracy
        self.recordedAt = recordedAt
        self.trip = trip
    }
}
