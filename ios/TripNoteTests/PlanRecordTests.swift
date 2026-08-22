import Foundation
import Testing
@testable import TripNote

// メモ: SyncRecordTests と同じく、DTO 変換は unmanaged なエンティティ
// (コンテナ未挿入)だけで検証する。
@MainActor
struct PlanRecordTests {
    private func encodeToJSON(_ value: some Encodable) throws -> String {
        let data = try SyncClient.encoder.encode(value)
        return String(decoding: data, as: UTF8.self)
    }

    @Test func 新規プランエンティティはneedsSyncがtrue() {
        #expect(TripDayEntity(date: "2026-09-01").needsSync)
        #expect(CheckpointEntity(type: .sightseeing, name: "松本城").needsSync)
    }

    @Test func TripDayRecordはsnake_caseで明示的なnullを含む() throws {
        let trip = TripEntity(title: "t")
        let day = TripDayEntity(
            date: "2026-09-01",
            updatedAt: Date(timeIntervalSince1970: 0),
            trip: trip
        )
        let record = try #require(TripDayRecord(day))
        #expect(record.tripId == trip.id)
        let json = try encodeToJSON(record)
        #expect(json.contains("\"trip_id\":"))
        #expect(json.contains("\"date\":\"2026-09-01\""))
        // 一括 upsert で行ごとのキーを揃えるため、nil でも省略せず null を送る
        #expect(json.contains("\"title\":null"))
        #expect(json.contains("\"note\":null"))
        #expect(json.contains("\"updated_at\":\"1970-01-01T00:00:00.000Z\""))
        #expect(json.contains("\"deleted_at\":null"))
    }

    @Test func tripと関連が切れた日はレコードにならない() {
        #expect(TripDayRecord(TripDayEntity(date: "2026-09-01")) == nil)
    }

    @Test func CheckpointRecordは全カラムをsnake_caseで含む() throws {
        let trip = TripEntity(title: "t")
        let day = TripDayEntity(date: "2026-09-01", trip: trip)
        let checkpoint = CheckpointEntity(
            type: .lodging,
            name: "浅間温泉の宿",
            latitude: 36.2571,
            longitude: 137.9841,
            plannedTime: Date(timeIntervalSince1970: 3600),
            sortOrder: 2,
            updatedAt: Date(timeIntervalSince1970: 0),
            trip: trip,
            tripDay: day
        )
        let record = try #require(CheckpointRecord(checkpoint))
        #expect(record.tripId == trip.id)
        #expect(record.tripDayId == day.id)
        let json = try encodeToJSON(record)
        #expect(json.contains("\"trip_day_id\":"))
        #expect(json.contains("\"type\":\"lodging\""))
        #expect(json.contains("\"name\":\"浅間温泉の宿\""))
        #expect(json.contains("\"planned_time\":\"1970-01-01T01:00:00.000Z\""))
        #expect(json.contains("\"sort_order\":2"))
        #expect(json.contains("\"note\":null"))
        #expect(json.contains("\"deleted_at\":null"))
    }

    @Test func 座標未定のCheckpointRecordはnullを送る() throws {
        let trip = TripEntity(title: "t")
        let day = TripDayEntity(date: "2026-09-01", trip: trip)
        let checkpoint = CheckpointEntity(type: .other, name: "松本駅周辺", trip: trip, tripDay: day)
        let json = try encodeToJSON(try #require(CheckpointRecord(checkpoint)))
        #expect(json.contains("\"latitude\":null"))
        #expect(json.contains("\"longitude\":null"))
        #expect(json.contains("\"planned_time\":null"))
    }

    @Test func tripDayと関連が切れたチェックポイントはレコードにならない() {
        let trip = TripEntity(title: "t")
        let checkpoint = CheckpointEntity(type: .cafe, name: "c", trip: trip)
        #expect(CheckpointRecord(checkpoint) == nil)
    }

    @Test func 未知のtypeRawValueはotherに落ちる() {
        let checkpoint = CheckpointEntity(type: .cafe, name: "c")
        checkpoint.typeRawValue = "unknown-type"
        #expect(checkpoint.type == .other)
    }

    @Test func sortedDaysとsortedCheckpointsは削除済みを除いて並べる() {
        let trip = TripEntity(title: "t")
        let day2 = TripDayEntity(date: "2026-09-02", trip: trip)
        let day1 = TripDayEntity(date: "2026-09-01", trip: trip)
        let deleted = TripDayEntity(date: "2026-08-31", trip: trip)
        deleted.deletedAt = Date()
        trip.days = [day2, day1, deleted]
        #expect(trip.sortedDays.map(\.date) == ["2026-09-01", "2026-09-02"])

        let b = CheckpointEntity(type: .cafe, name: "b", sortOrder: 1, trip: trip, tripDay: day1)
        let a = CheckpointEntity(type: .cafe, name: "a", sortOrder: 0, trip: trip, tripDay: day1)
        let gone = CheckpointEntity(type: .cafe, name: "x", sortOrder: 2, trip: trip, tripDay: day1)
        gone.deletedAt = Date()
        day1.checkpoints = [b, a, gone]
        #expect(day1.sortedCheckpoints.map(\.name) == ["a", "b"])
    }
}
