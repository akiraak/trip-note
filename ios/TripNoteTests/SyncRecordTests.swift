import Foundation
import SwiftData
import Testing
@testable import TripNote

// メモ: ホストアプリが同じ @Model クラスで ModelContainer を作成済みのため、
// テスト側で 2 つ目のコンテナを作って insert すると SwiftData 内部でクラッシュする。
// DTO 変換は unmanaged なエンティティ(コンテナ未挿入)だけで検証する。
@MainActor
struct SyncRecordTests {
    /// 実際の同期で使うエンコーダ(SyncClient.encoder)でエンコードする
    private func encodeToJSON(_ value: some Encodable) throws -> String {
        let data = try SyncClient.encoder.encode(value)
        return String(decoding: data, as: UTF8.self)
    }

    @Test func 新規エンティティはneedsSyncがtrue() {
        #expect(TripEntity(title: "t").needsSync)
        #expect(LocationPointEntity(latitude: 0, longitude: 0, recordedAt: Date()).needsSync)
    }

    @Test func TripRecordはsnake_caseで進行中はended_atをnullにする() throws {
        let trip = TripEntity(
            title: "テスト旅行",
            startedAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 60)
        )
        let json = try encodeToJSON(TripRecord(trip))
        #expect(json.contains("\"started_at\":\"1970-01-01T00:00:00.000Z\""))
        #expect(json.contains("\"ended_at\":null"))
        #expect(json.contains("\"title\":\"テスト旅行\""))
        // 一括 upsert で行ごとのキーを揃えるため、nil でも省略せず null を送る
        #expect(json.contains("\"transport\":null"))
        #expect(json.contains("\"deleted_at\":null"))
        // 編集時刻(LWW の基準)はクライアントが打刻して送る
        #expect(json.contains("\"updated_at\":\"1970-01-01T00:01:00.000Z\""))
    }

    @Test func プラン段階のTripRecordはstarted_atがnull() throws {
        let trip = TripEntity(title: "プラン中の旅行")
        #expect(trip.status == .planning)
        let json = try encodeToJSON(TripRecord(trip))
        #expect(json.contains("\"started_at\":null"))
    }

    @Test func transportとdeletedAtは値があれば含まれる() throws {
        let trip = TripEntity(title: "t", startedAt: Date(timeIntervalSince1970: 0))
        trip.transport = "car"
        trip.deletedAt = Date(timeIntervalSince1970: 3600)
        let json = try encodeToJSON(TripRecord(trip))
        #expect(json.contains("\"transport\":\"car\""))
        #expect(json.contains("\"deleted_at\":\"1970-01-01T01:00:00.000Z\""))
    }

    @Test func 旅行の状態はstartedAtとendedAtから導出される() {
        #expect(TripEntity(title: "t").status == .planning)
        #expect(TripEntity(title: "t", startedAt: Date()).status == .inProgress)
        #expect(
            TripEntity(title: "t", startedAt: Date(), endedAt: Date()).status == .finished
        )
    }

    @Test func TripRecordは終了後にended_atを含む() throws {
        let trip = TripEntity(
            title: "t",
            startedAt: Date(timeIntervalSince1970: 0),
            endedAt: Date(timeIntervalSince1970: 3600)
        )
        let json = try encodeToJSON(TripRecord(trip))
        #expect(json.contains("\"ended_at\":\"1970-01-01T01:00:00.000Z\""))
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
        #expect(json.contains("\"recorded_at\":\"1970-01-01T00:00:00.000Z\""))
    }

    @Test func tripと関連が切れた点はレコードにならない() throws {
        let point = LocationPointEntity(latitude: 0, longitude: 0, recordedAt: Date())
        #expect(LocationPointRecord(point) == nil)
    }
}
