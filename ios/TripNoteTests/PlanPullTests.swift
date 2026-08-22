import Foundation
import Testing
@testable import TripNote

// メモ: SyncRecordTests と同じく、pull 反映(LWW)は unmanaged なエンティティ
// (コンテナ未挿入)だけで検証する。
@MainActor
struct PlanPullTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try SyncClient.decoder.decode(type, from: Data(json.utf8))
    }

    // MARK: - pull 応答のデコード

    @Test func PullResponseをデコードできる() throws {
        let tripId = UUID()
        let dayId = UUID()
        let json = """
        {
          "serverTime": "2026-08-21T10:00:00.123Z",
          "trips": [
            { "id": "\(tripId.uuidString)", "title": "松本旅行",
              "started_at": null, "ended_at": null, "transport": "car",
              "departure_at": "2026-09-01T08:30:00.000Z", "destination": "上高地",
              "updated_at": "2026-08-21T09:00:00.000Z", "deleted_at": null }
          ],
          "days": [
            { "id": "\(dayId.uuidString)", "trip_id": "\(tripId.uuidString)",
              "date": "2026-09-01", "title": "松本周辺を観光して泊", "note": null,
              "updated_at": "2026-08-21T09:00:00.000Z", "deleted_at": null }
          ],
          "checkpoints": [
            { "id": "\(UUID().uuidString)", "trip_id": "\(tripId.uuidString)",
              "trip_day_id": "\(dayId.uuidString)", "type": "lodging",
              "name": "浅間温泉の宿", "latitude": 36.2571, "longitude": 137.9841,
              "planned_time": null, "note": null, "sort_order": 2,
              "updated_at": "2026-08-21T09:00:00.000Z", "deleted_at": null }
          ]
        }
        """
        let response = try decode(PullResponse.self, json)
        #expect(response.serverTime == "2026-08-21T10:00:00.123Z")
        #expect(response.trips.first?.id == tripId)
        #expect(response.trips.first?.transport == "car")
        #expect(response.trips.first?.departureAt != nil)
        #expect(response.trips.first?.destination == "上高地")
        #expect(response.days.first?.tripId == tripId)
        #expect(response.days.first?.date == "2026-09-01")
        #expect(response.checkpoints.first?.tripDayId == dayId)
        #expect(response.checkpoints.first?.sortOrder == 2)
        #expect(response.checkpoints.first?.latitude == 36.2571)
    }

    @Test func 小数秒なしのISO8601もデコードできる() throws {
        // Web(Server Actions)側の打刻形式が揺れても受け付ける
        let json = """
        { "id": "\(UUID().uuidString)", "title": "t",
          "started_at": "2026-08-21T09:00:00Z", "ended_at": null, "transport": null,
          "updated_at": "2026-08-21T09:30:00Z", "deleted_at": null }
        """
        let record = try decode(TripPullRecord.self, json)
        #expect(record.startedAt == Date(timeIntervalSince1970: 1_787_302_800))
        #expect(record.updatedAt == Date(timeIntervalSince1970: 1_787_304_600))
    }

    // MARK: - LWW(trip)

    private func tripRecord(
        title: String = "サーバ側の編集",
        updatedAt: Date,
        deletedAt: Date? = nil,
        id: UUID = UUID()
    ) throws -> TripPullRecord {
        let deleted = deletedAt.map { "\"\(SyncDateFormat.string(from: $0))\"" } ?? "null"
        return try decode(TripPullRecord.self, """
        { "id": "\(id.uuidString)", "title": "\(title)",
          "started_at": null, "ended_at": null, "transport": "train",
          "departure_at": "2026-09-01T08:30:00.000Z", "destination": "上高地",
          "updated_at": "\(SyncDateFormat.string(from: updatedAt))",
          "deleted_at": \(deleted) }
        """)
    }

    @Test func 新しいレコードはローカルに反映されneedsSyncが下りる() throws {
        let trip = TripEntity(title: "ローカル", updatedAt: Date(timeIntervalSince1970: 0))
        trip.needsSync = true
        let record = try tripRecord(updatedAt: Date(timeIntervalSince1970: 60), id: trip.id)
        #expect(PlanPull.apply(record, to: trip))
        #expect(trip.title == "サーバ側の編集")
        #expect(trip.transport == "train")
        #expect(trip.departureAt != nil)
        #expect(trip.destination == "上高地")
        #expect(trip.updatedAt == Date(timeIntervalSince1970: 60))
        #expect(!trip.needsSync)
    }

    @Test func 古いレコードと同時刻のレコードは無視される() throws {
        let trip = TripEntity(title: "ローカル", updatedAt: Date(timeIntervalSince1970: 60))
        let older = try tripRecord(updatedAt: Date(timeIntervalSince1970: 0), id: trip.id)
        #expect(!PlanPull.apply(older, to: trip))
        // 同時刻も既存を保持(自分の push が pull で返ってきたケース)
        let same = try tripRecord(updatedAt: Date(timeIntervalSince1970: 60), id: trip.id)
        #expect(!PlanPull.apply(same, to: trip))
        #expect(trip.title == "ローカル")
        #expect(trip.needsSync)
    }

    @Test func tombstoneが反映される() throws {
        let trip = TripEntity(title: "ローカル", updatedAt: Date(timeIntervalSince1970: 0))
        let record = try tripRecord(
            updatedAt: Date(timeIntervalSince1970: 60),
            deletedAt: Date(timeIntervalSince1970: 60),
            id: trip.id
        )
        #expect(PlanPull.apply(record, to: trip))
        #expect(trip.deletedAt == Date(timeIntervalSince1970: 60))
    }

    @Test func makeTripはサーバ由来なのでneedsSyncが下りている() throws {
        let record = try tripRecord(updatedAt: Date(timeIntervalSince1970: 60))
        let trip = PlanPull.makeTrip(record)
        #expect(trip.id == record.id)
        #expect(trip.title == "サーバ側の編集")
        #expect(!trip.needsSync)
    }

    // MARK: - LWW(day / checkpoint)

    @Test func dayのLWWと反映() throws {
        let day = TripDayEntity(date: "2026-09-01", updatedAt: Date(timeIntervalSince1970: 0))
        let record = try decode(TripDayPullRecord.self, """
        { "id": "\(day.id.uuidString)", "trip_id": "\(UUID().uuidString)",
          "date": "2026-09-02", "title": "上高地へ", "note": "早出",
          "departure_time": "07:30",
          "updated_at": "1970-01-01T00:01:00.000Z", "deleted_at": null }
        """)
        #expect(PlanPull.apply(record, to: day))
        #expect(day.date == "2026-09-02")
        #expect(day.title == "上高地へ")
        #expect(day.note == "早出")
        #expect(day.departureTime == "07:30")
        #expect(!day.needsSync)
        // 古いレコードは無視される
        let older = try decode(TripDayPullRecord.self, """
        { "id": "\(day.id.uuidString)", "trip_id": "\(UUID().uuidString)",
          "date": "2026-09-03", "title": null, "note": null,
          "departure_time": null,
          "updated_at": "1970-01-01T00:00:30.000Z", "deleted_at": null }
        """)
        #expect(!PlanPull.apply(older, to: day))
        #expect(day.date == "2026-09-02")
        #expect(day.departureTime == "07:30")
    }

    @Test func checkpointの反映で別の日への移動も適用される() throws {
        let trip = TripEntity(title: "t")
        let day1 = TripDayEntity(date: "2026-09-01", trip: trip)
        let day2 = TripDayEntity(date: "2026-09-02", trip: trip)
        let checkpoint = CheckpointEntity(
            type: .cafe,
            name: "旧名",
            updatedAt: Date(timeIntervalSince1970: 0),
            trip: trip,
            tripDay: day1
        )
        let record = try decode(CheckpointPullRecord.self, """
        { "id": "\(checkpoint.id.uuidString)", "trip_id": "\(trip.id.uuidString)",
          "trip_day_id": "\(day2.id.uuidString)", "type": "restaurant",
          "name": "新名", "latitude": 36.0, "longitude": 138.0,
          "planned_time": "2026-09-02T03:00:00.000Z", "note": null, "sort_order": 5,
          "updated_at": "1970-01-01T00:01:00.000Z", "deleted_at": null }
        """)
        #expect(PlanPull.apply(record, to: checkpoint, day: day2))
        #expect(checkpoint.name == "新名")
        #expect(checkpoint.type == .restaurant)
        #expect(checkpoint.tripDay?.id == day2.id)
        #expect(checkpoint.sortOrder == 5)
        #expect(checkpoint.plannedTime != nil)
        #expect(!checkpoint.needsSync)
    }

    @Test func makeCheckpointは関連を張りneedsSyncが下りている() throws {
        let trip = TripEntity(title: "t")
        let day = TripDayEntity(date: "2026-09-01", trip: trip)
        let record = try decode(CheckpointPullRecord.self, """
        { "id": "\(UUID().uuidString)", "trip_id": "\(trip.id.uuidString)",
          "trip_day_id": "\(day.id.uuidString)", "type": "sightseeing",
          "name": "松本城", "latitude": null, "longitude": null,
          "planned_time": null, "note": null, "sort_order": 0,
          "updated_at": "1970-01-01T00:01:00.000Z", "deleted_at": null }
        """)
        let checkpoint = PlanPull.makeCheckpoint(record, trip: trip, day: day)
        #expect(checkpoint.trip?.id == trip.id)
        #expect(checkpoint.tripDay?.id == day.id)
        #expect(checkpoint.latitude == nil)
        #expect(!checkpoint.needsSync)
    }
}
