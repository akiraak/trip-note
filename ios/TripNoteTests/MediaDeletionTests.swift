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

    @Test func 一覧は撮影時刻順のまま() {
        let trip = TripEntity(title: "t")
        let later = makeMedia(fileName: "b.jpg", takenAt: Date(timeIntervalSince1970: 20))
        let earlier = makeMedia(fileName: "a.jpg", takenAt: Date(timeIntervalSince1970: 10))
        trip.media = [later, earlier]
        #expect(trip.sortedMedia.map(\.id) == [earlier.id, later.id])
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

    @Test func 無いファイルの削除は何も起こさない() {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "MediaStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        MediaStore(directory: directory).remove(fileName: "missing.jpg")
        #expect(!FileManager.default.fileExists(atPath: directory.path))
    }
}
