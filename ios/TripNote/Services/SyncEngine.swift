import Foundation
import Observation
import SwiftData

/// ローカル記録(SwiftData)を自宅サーバ(g3plus)と同期するエンジン。
/// push: `needsSync == true` の行をアップロードキューとして扱い、upsert で冪等に送る。
/// pull: プラン系(trips / trip_days / checkpoints)はサーバの更新分を取り込み、
/// 行単位の LWW(updated_at の新しい方が勝つ)でローカルへ反映する。
/// 記録はローカル優先: 同期は記録処理をブロックせず、失敗しても次回の同期で再送される。
@MainActor
@Observable
final class SyncEngine {
    static let pointBatchSize = 500
    /// 前回 pull の serverTime(次回の since)を保存する UserDefaults キー
    static let pullSinceKey = "syncPullSince"

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
            // 先に pull して他クライアント(Web)の編集を取り込んでから、ローカルの変更を送る
            // (行単位の LWW なので順序が逆でも壊れないが、この順が最新を保ちやすい)
            try await pullPlans(client)
            // 子は親を参照するため trips → days → checkpoints → points → media の順に送る
            try await pushTrips(client)
            try await pushDays(client)
            try await pushCheckpoints(client)
            try await pushPoints(client)
            try await pushMedia(client)
            lastSyncedAt = Date()
        } catch {
            lastError = "同期に失敗しました: \(error.localizedDescription)"
        }
    }

    // MARK: - pull(プラン系の双方向同期)

    private func pullPlans(_ client: SyncClient) async throws {
        let since = UserDefaults.standard.string(forKey: Self.pullSinceKey)
        let response = try await client.pull(since: since)
        try applyPull(response)
        // 適用が完了してから since を進める(途中失敗時は次回同じ範囲を再取得する)
        UserDefaults.standard.set(response.serverTime, forKey: Self.pullSinceKey)
    }

    private func applyPull(_ response: PullResponse) throws {
        // 子が親を参照するため trips → days → checkpoints の順に反映する
        for record in response.trips {
            if let trip = fetchTrip(id: record.id) {
                PlanPull.apply(record, to: trip)
            } else if record.deletedAt == nil {
                // ローカルに無い tombstone は取り込まない(消すものが無い)
                modelContext.insert(PlanPull.makeTrip(record))
            }
        }
        for record in response.days {
            if let day = fetchDay(id: record.id) {
                PlanPull.apply(record, to: day)
            } else if record.deletedAt == nil, let trip = fetchTrip(id: record.tripId) {
                modelContext.insert(PlanPull.makeDay(record, trip: trip))
            }
        }
        for record in response.checkpoints {
            // 親の day が見つからない場合はスキップし、次回 pull で day と一緒に取り込む
            if let checkpoint = fetchCheckpoint(id: record.id) {
                if let day = fetchDay(id: record.tripDayId) {
                    PlanPull.apply(record, to: checkpoint, day: day)
                }
            } else if record.deletedAt == nil,
                      let trip = fetchTrip(id: record.tripId),
                      let day = fetchDay(id: record.tripDayId) {
                modelContext.insert(PlanPull.makeCheckpoint(record, trip: trip, day: day))
            }
        }
        try modelContext.save()
    }

    private func fetchTrip(id: UUID) -> TripEntity? {
        var descriptor = FetchDescriptor<TripEntity>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try? modelContext.fetch(descriptor).first
    }

    private func fetchDay(id: UUID) -> TripDayEntity? {
        var descriptor = FetchDescriptor<TripDayEntity>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try? modelContext.fetch(descriptor).first
    }

    private func fetchCheckpoint(id: UUID) -> CheckpointEntity? {
        var descriptor = FetchDescriptor<CheckpointEntity>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try? modelContext.fetch(descriptor).first
    }

    // MARK: - push

    private func pushTrips(_ client: SyncClient) async throws {
        let descriptor = FetchDescriptor<TripEntity>(predicate: #Predicate { $0.needsSync })
        let trips = try modelContext.fetch(descriptor)
        guard !trips.isEmpty else { return }
        try await client.send(trips: trips.map(TripRecord.init))
        for trip in trips {
            trip.needsSync = false
        }
        try modelContext.save()
    }

    private func pushDays(_ client: SyncClient) async throws {
        let descriptor = FetchDescriptor<TripDayEntity>(predicate: #Predicate { $0.needsSync })
        let days = try modelContext.fetch(descriptor)
        guard !days.isEmpty else { return }
        let records = days.compactMap(TripDayRecord.init)
        if !records.isEmpty {
            try await client.send(days: records)
        }
        // trip との関連が切れた日(records に入らなかった行)も needsSync を下ろし、
        // 毎回送り続けないようにする
        for day in days {
            day.needsSync = false
        }
        try modelContext.save()
    }

    private func pushCheckpoints(_ client: SyncClient) async throws {
        let descriptor = FetchDescriptor<CheckpointEntity>(predicate: #Predicate { $0.needsSync })
        let checkpoints = try modelContext.fetch(descriptor)
        guard !checkpoints.isEmpty else { return }
        let records = checkpoints.compactMap(CheckpointRecord.init)
        if !records.isEmpty {
            try await client.send(checkpoints: records)
        }
        for checkpoint in checkpoints {
            checkpoint.needsSync = false
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
