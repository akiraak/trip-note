import Foundation
import Observation
import SwiftData

/// ローカル記録(SwiftData)を自宅サーバ(g3plus)へアップロードする同期エンジン。
/// `needsSync == true` の行をアップロードキューとして扱い、upsert で冪等に送る。
/// 記録はローカル優先: 同期は記録処理をブロックせず、失敗しても次回の同期で再送される。
@MainActor
@Observable
final class SyncEngine {
    static let pointBatchSize = 500

    private let modelContext: ModelContext
    private let client: SyncClient?
    private let store: MediaStore

    private(set) var isSyncing = false
    private(set) var lastError: String?
    private(set) var lastSyncedAt: Date?

    var isConfigured: Bool { client != nil }

    init(
        modelContext: ModelContext,
        client: SyncClient? = SyncClient.fromBundle(),
        store: MediaStore = .makeDefault()
    ) {
        self.modelContext = modelContext
        self.client = client
        self.store = store
    }

    var pendingPointCount: Int {
        let descriptor = FetchDescriptor<LocationPointEntity>(
            predicate: #Predicate { $0.needsSync }
        )
        return (try? modelContext.fetchCount(descriptor)) ?? 0
    }

    var pendingMediaCount: Int {
        let descriptor = FetchDescriptor<MediaEntity>(
            predicate: #Predicate { $0.needsSync }
        )
        return (try? modelContext.fetchCount(descriptor)) ?? 0
    }

    func syncNow() async {
        guard !isSyncing, let client else { return }
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }
        do {
            // メディアは trip_id / location_point_id を参照するため trips → points → media の順に送る
            try await pushTrips(client)
            try await pushPoints(client)
            try await pushMedia(client)
            lastSyncedAt = Date()
        } catch {
            lastError = "同期に失敗しました: \(error.localizedDescription)"
        }
    }

    private func pushTrips(_ client: SyncClient) async throws {
        let descriptor = FetchDescriptor<TripEntity>(predicate: #Predicate { $0.needsSync })
        let trips = try modelContext.fetch(descriptor)
        guard !trips.isEmpty else { return }
        try await client.send(trips: trips.map(TripRecord.init), points: [])
        for trip in trips {
            trip.needsSync = false
        }
        try modelContext.save()
    }

    private func pushPoints(_ client: SyncClient) async throws {
        while true {
            var descriptor = FetchDescriptor<LocationPointEntity>(
                predicate: #Predicate { $0.needsSync },
                sortBy: [SortDescriptor(\.recordedAt)]
            )
            descriptor.fetchLimit = Self.pointBatchSize
            let points = try modelContext.fetch(descriptor)
            guard !points.isEmpty else { return }
            let records = points.compactMap(LocationPointRecord.init)
            if !records.isEmpty {
                try await client.send(trips: [], points: records)
            }
            // trip との関連が切れた点(records に入らなかった点)も needsSync を下ろし、
            // 毎回同じバッチを取り続けて無限ループになるのを防ぐ
            for point in points {
                point.needsSync = false
            }
            try modelContext.save()
        }
    }

    private func pushMedia(_ client: SyncClient) async throws {
        let descriptor = FetchDescriptor<MediaEntity>(
            predicate: #Predicate { $0.needsSync },
            sortBy: [SortDescriptor(\.takenAt)]
        )
        let mediaItems = try modelContext.fetch(descriptor)
        for media in mediaItems {
            let fileURL = store.url(for: media.fileName)
            guard
                let meta = MediaUploadMeta(media),
                FileManager.default.fileExists(atPath: fileURL.path(percentEncoded: false))
            else {
                // trip との関連が切れた・ファイルが無いメディアは同期できないため
                // needsSync を下ろして再送し続けない
                media.needsSync = false
                try modelContext.save()
                continue
            }
            try await client.upload(media: meta, fileURL: fileURL)
            // 動画は大きく途中失敗もあり得るので 1 件ごとに確定させる
            media.needsSync = false
            try modelContext.save()
        }
    }
}
