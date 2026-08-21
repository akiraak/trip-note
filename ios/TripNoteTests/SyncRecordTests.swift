import Foundation
import SwiftData
import Testing
@testable import TripNote

// メモ: ホストアプリが同じ @Model クラスで ModelContainer を作成済みのため、
// テスト側で 2 つ目のコンテナを作って insert すると SwiftData 内部でクラッシュする。
// DTO 変換は unmanaged なエンティティ(コンテナ未挿入)だけで検証する。
@MainActor
struct SyncRecordTests {
    /// supabase-swift と同様に ISO8601 で日付をエンコードする(検証用)
    private func encodeToJSON(_ value: some Encodable) throws -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        return String(decoding: data, as: UTF8.self)
    }

    @Test func 新規エンティティはneedsSyncがtrue() {
        #expect(TripEntity(title: "t").needsSync)
        #expect(LocationPointEntity(latitude: 0, longitude: 0, recordedAt: Date()).needsSync)
    }

    @Test func TripRecordはsnake_caseで記録中はended_atをnullにする() throws {
        let trip = TripEntity(title: "テスト旅行", startedAt: Date(timeIntervalSince1970: 0))
        let json = try encodeToJSON(TripRecord(trip))
        #expect(json.contains("\"started_at\":\"1970-01-01T00:00:00Z\""))
        #expect(json.contains("\"ended_at\":null"))
        #expect(json.contains("\"title\":\"テスト旅行\""))
    }

    @Test func TripRecordは終了後にended_atを含む() throws {
        let trip = TripEntity(
            title: "t",
            startedAt: Date(timeIntervalSince1970: 0),
            endedAt: Date(timeIntervalSince1970: 3600)
        )
        let json = try encodeToJSON(TripRecord(trip))
        #expect(json.contains("\"ended_at\":\"1970-01-01T01:00:00Z\""))
    }

    @Test func LocationPointRecordはtrip_idと明示的なnullを含む() throws {
        let trip = TripEntity(title: "t")
        let point = LocationPointEntity(
            latitude: 35.681236,
            longitude: 139.767125,
            recordedAt: Date(timeIntervalSince1970: 0),
            trip: trip
        )
        let record = try #require(LocationPointRecord(point))
        #expect(record.tripId == trip.id)
        let json = try encodeToJSON(record)
        // 一括 upsert で行ごとのキーを揃えるため、nil でも省略せず null を送る
        #expect(json.contains("\"altitude\":null"))
        #expect(json.contains("\"accuracy\":null"))
        #expect(json.contains("\"trip_id\":"))
        #expect(json.contains("\"recorded_at\":\"1970-01-01T00:00:00Z\""))
    }

    @Test func tripと関連が切れた点はレコードにならない() throws {
        let point = LocationPointEntity(latitude: 0, longitude: 0, recordedAt: Date())
        #expect(LocationPointRecord(point) == nil)
    }
}
