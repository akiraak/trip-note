import Foundation
import Testing
@testable import TripNote

// メモ: SyncRecordTests と同じく、エンティティは unmanaged(コンテナ未挿入)で検証する
@MainActor
struct MediaUploadMetaTests {
    @Test func 新規メディアはneedsSyncがtrue() {
        let media = MediaEntity(
            type: .photo, fileName: "a.jpg", thumbnailFileName: "a-thumb.jpg", takenAt: Date()
        )
        #expect(media.needsSync)
    }

    @Test func メタはtripと点のidとISO8601日時を持つ() throws {
        let trip = TripEntity(title: "t")
        let point = LocationPointEntity(
            latitude: 35, longitude: 135, recordedAt: Date(), trip: trip
        )
        let media = MediaEntity(
            type: .photo,
            fileName: "abc.jpg",
            thumbnailFileName: "abc-thumb.jpg",
            takenAt: Date(timeIntervalSince1970: 0),
            trip: trip,
            locationPoint: point
        )
        let meta = try #require(MediaUploadMeta(media))
        #expect(meta.tripId == trip.id)
        #expect(meta.locationPointId == point.id)
        #expect(meta.ext == "jpg")
        let items = Dictionary(uniqueKeysWithValues: meta.queryItems.map { ($0.name, $0.value) })
        #expect(items["id"] == media.id.uuidString)
        #expect(items["trip_id"] == trip.id.uuidString)
        #expect(items["location_point_id"] == point.id.uuidString)
        #expect(items["type"] == "photo")
        #expect(items["ext"] == "jpg")
        // サーバの taken_at と揃う小数秒付き ISO8601
        #expect(items["taken_at"] == "1970-01-01T00:00:00.000Z")
    }

    @Test func 点が無ければlocation_point_idを送らない() throws {
        let trip = TripEntity(title: "t")
        let media = MediaEntity(
            type: .video, fileName: "v.mp4", thumbnailFileName: "v-thumb.jpg",
            takenAt: Date(), trip: trip
        )
        let meta = try #require(MediaUploadMeta(media))
        #expect(meta.ext == "mp4")
        #expect(meta.type == "video")
        #expect(!meta.queryItems.contains { $0.name == "location_point_id" })
    }

    @Test func メディア自身の座標を送る() throws {
        let trip = TripEntity(title: "t")
        let media = MediaEntity(
            type: .photo, fileName: "a.jpg", thumbnailFileName: "a-thumb.jpg",
            takenAt: Date(), trip: trip, latitude: 47.6205, longitude: -122.3493
        )
        let meta = try #require(MediaUploadMeta(media))
        let items = Dictionary(uniqueKeysWithValues: meta.queryItems.map { ($0.name, $0.value) })
        #expect(items["latitude"] == "47.6205")
        #expect(items["longitude"] == "-122.3493")
    }

    @Test func 座標が無ければ送らない() throws {
        let trip = TripEntity(title: "t")
        let media = MediaEntity(
            type: .photo, fileName: "a.jpg", thumbnailFileName: "a-thumb.jpg",
            takenAt: Date(), trip: trip
        )
        let meta = try #require(MediaUploadMeta(media))
        #expect(!meta.queryItems.contains { $0.name == "latitude" })
        #expect(!meta.queryItems.contains { $0.name == "longitude" })
    }

    @Test func 地図の座標は自身の位置を優先し無ければ記録点を使う() {
        let trip = TripEntity(title: "t")
        let point = LocationPointEntity(
            latitude: 35, longitude: 135, recordedAt: Date(), trip: trip
        )
        let own = MediaEntity(
            type: .photo, fileName: "a.jpg", thumbnailFileName: "a-thumb.jpg",
            takenAt: Date(), trip: trip, locationPoint: point,
            latitude: 47.6205, longitude: -122.3493
        )
        #expect(own.displayCoordinate?.latitude == 47.6205)
        let linked = MediaEntity(
            type: .photo, fileName: "b.jpg", thumbnailFileName: "b-thumb.jpg",
            takenAt: Date(), trip: trip, locationPoint: point
        )
        #expect(linked.displayCoordinate == MediaCoordinate.Coordinate(latitude: 35, longitude: 135))
        let neither = MediaEntity(
            type: .photo, fileName: "c.jpg", thumbnailFileName: "c-thumb.jpg",
            takenAt: Date(), trip: trip
        )
        #expect(neither.displayCoordinate == nil)
    }

    @Test func tripと関連が切れたメディアはメタにならない() {
        let media = MediaEntity(
            type: .photo, fileName: "a.jpg", thumbnailFileName: "a-thumb.jpg", takenAt: Date()
        )
        #expect(MediaUploadMeta(media) == nil)
    }
}
