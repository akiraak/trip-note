import Foundation
import SwiftData

@Model
final class TripEntity {
    @Attribute(.unique) var id: UUID
    var title: String
    var startedAt: Date
    var endedAt: Date?
    /// Supabase へ未同期の変更があるか(作成・記録停止で true に戻す)
    var needsSync: Bool = true

    @Relationship(deleteRule: .cascade, inverse: \LocationPointEntity.trip)
    var points: [LocationPointEntity] = []

    @Relationship(deleteRule: .cascade, inverse: \MediaEntity.trip)
    var media: [MediaEntity] = []

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

    var sortedMedia: [MediaEntity] {
        media.sorted { $0.takenAt < $1.takenAt }
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
    /// Supabase へ未同期か(位置情報は不変なのでアップロード成功で false になったら変わらない)
    var needsSync: Bool = true

    @Relationship(deleteRule: .nullify, inverse: \MediaEntity.locationPoint)
    var media: [MediaEntity] = []

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

@Model
final class MediaEntity {
    @Attribute(.unique) var id: UUID
    /// MediaType.rawValue("photo" | "video")。SwiftData には文字列で保存する
    var typeRawValue: String
    /// MediaStore 内のファイル名(`<id>.jpg` / `<id>.mp4` / `<id>.mov`)
    var fileName: String
    /// グリッド・地図マーカー用サムネイル(`<id>-thumb.jpg`)
    var thumbnailFileName: String
    var takenAt: Date
    var trip: TripEntity?
    /// 撮影時刻に最も近い記録点(MediaAttachment)。点が無い trip では nil
    var locationPoint: LocationPointEntity?
    /// サーバへ未同期か(メディアは不変なのでアップロード成功で false のまま)
    var needsSync: Bool = true

    init(
        id: UUID = UUID(),
        type: MediaType,
        fileName: String,
        thumbnailFileName: String,
        takenAt: Date,
        trip: TripEntity? = nil,
        locationPoint: LocationPointEntity? = nil
    ) {
        self.id = id
        self.typeRawValue = type.rawValue
        self.fileName = fileName
        self.thumbnailFileName = thumbnailFileName
        self.takenAt = takenAt
        self.trip = trip
        self.locationPoint = locationPoint
    }

    var type: MediaType { MediaType(rawValue: typeRawValue) ?? .photo }
}
