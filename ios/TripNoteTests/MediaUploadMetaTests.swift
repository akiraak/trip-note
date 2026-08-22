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

    @Test func tripと関連が切れたメディアはメタにならない() {
        let media = MediaEntity(
            type: .photo, fileName: "a.jpg", thumbnailFileName: "a-thumb.jpg", takenAt: Date()
        )
        #expect(MediaUploadMeta(media) == nil)
    }
}
