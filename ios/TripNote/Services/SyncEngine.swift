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

    private(set) var isSyncing = false
    private(set) var lastError: String?
    private(set) var lastSyncedAt: Date?

    var isConfigured: Bool { client != nil }

    init(modelContext: ModelContext, client: SyncClient? = SyncClient.fromBundle()) {
        self.modelContext = modelContext
        self.client = client
    }

    var pendingPointCount: Int {
        let descriptor = FetchDescriptor<LocationPointEntity>(
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
            // 点は trip_id を参照するため trip を先に送る
            try await pushTrips(client)
            try await pushPoints(client)
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
}
