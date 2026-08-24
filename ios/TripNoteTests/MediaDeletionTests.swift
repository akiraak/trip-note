import Foundation
import Testing
@testable import TripNote

// メモ: MediaUploadMetaTests と同じく、エンティティは unmanaged(コンテナ未挿入)で検証する
@MainActor
struct MediaDeletionTests {
    private func makeMedia(
        fileName: String,
        takenAt: Date,
        deletedAt: Date? = nil
    ) -> MediaEntity {
        let media = MediaEntity(
            type: .photo,
            fileName: fileName,
            thumbnailFileName: fileName.replacingOccurrences(of: ".jpg", with: "-thumb.jpg"),
            takenAt: takenAt
        )
        media.deletedAt = deletedAt
        return media
    }

    @Test func 新規メディアは削除済みではない() {
        #expect(makeMedia(fileName: "a.jpg", takenAt: Date()).deletedAt == nil)
    }

    @Test func 削除済みは一覧から外れる() {
        let trip = TripEntity(title: "t")
        let kept = makeMedia(fileName: "a.jpg", takenAt: Date(timeIntervalSince1970: 10))
        let deleted = makeMedia(
            fileName: "b.jpg",
            takenAt: Date(timeIntervalSince1970: 20),
            deletedAt: Date()
        )
        trip.media = [kept, deleted]
        #expect(trip.sortedMedia.map(\.id) == [kept.id])
    }

    @Test func 一覧は新しい順() {
        let trip = TripEntity(title: "t")
        let later = makeMedia(fileName: "b.jpg", takenAt: Date(timeIntervalSince1970: 20))
        let earlier = makeMedia(fileName: "a.jpg", takenAt: Date(timeIntervalSince1970: 10))
        trip.media = [earlier, later]
        #expect(trip.sortedMedia.map(\.id) == [later.id, earlier.id])
    }

    @Test func 同時刻の並びはidで決まる() {
        let trip = TripEntity(title: "t")
        let sameTime = Date(timeIntervalSince1970: 10)
        let one = makeMedia(fileName: "a.jpg", takenAt: sameTime)
        let other = makeMedia(fileName: "b.jpg", takenAt: sameTime)
        trip.media = [one, other]
        let ids = trip.sortedMedia.map(\.id.uuidString)
        #expect(ids == ids.sorted(by: >))
    }

    @Test func ストアの削除は本体とサムネイルを消す() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "MediaStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        let store = MediaStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }

        try store.write(Data([0x1]), fileName: "a.jpg")
        try store.write(Data([0x2]), fileName: "a-thumb.jpg")
        #expect(FileManager.default.fileExists(atPath: store.url(for: "a.jpg").path))

        store.remove(fileName: "a.jpg")
        store.remove(fileName: "a-thumb.jpg")
        #expect(!FileManager.default.fileExists(atPath: store.url(for: "a.jpg").path))
        #expect(!FileManager.default.fileExists(atPath: store.url(for: "a-thumb.jpg").path))
    }

    // MARK: - pull(Web で削除されたメディア)

    private func decodePull(_ json: String) throws -> PullResponse {
        try SyncClient.decoder.decode(PullResponse.self, from: Data(json.utf8))
    }

    @Test func pullの削除メディアをデコードできる() throws {
        let mediaId = UUID()
        let tripId = UUID()
        let response = try decodePull("""
        {
          "serverTime": "2026-08-24T10:00:00.000Z",
          "trips": [], "days": [], "checkpoints": [],
          "media": [
            { "id": "\(mediaId.uuidString)", "trip_id": "\(tripId.uuidString)",
              "deleted_at": "2026-08-24T09:59:00.000Z" }
          ]
        }
        """)
        #expect(response.deletedMedia.count == 1)
        #expect(response.deletedMedia.first?.id == mediaId)
        #expect(response.deletedMedia.first?.tripId == tripId)
    }

    @Test func mediaを返さない旧サーバの応答も受け付ける() throws {
        let response = try decodePull("""
        { "serverTime": "2026-08-24T10:00:00.000Z",
          "trips": [], "days": [], "checkpoints": [] }
        """)
        #expect(response.deletedMedia.isEmpty)
    }

    @Test func 無いファイルの削除は何も起こさない() {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "MediaStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        MediaStore(directory: directory).remove(fileName: "missing.jpg")
        #expect(!FileManager.default.fileExists(atPath: directory.path))
    }
}
