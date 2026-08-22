import Foundation
import Testing
@testable import TripNote

// メモ: 他のテストと同じく、unmanaged なエンティティ(コンテナ未挿入)だけで検証する。
// unmanaged では inverse relationship が自動で張られないため、
// 親から辿るテストでは trip.days / day.checkpoints を明示的に設定する。
@MainActor
struct PlanEditorTests {
    /// タイムゾーン差で日付が揺れないよう JST 固定のカレンダーで検証する
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        return calendar
    }

    private func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    // MARK: - 日付生成

    @Test func 開始日から月を跨いで連続した日付を生成する() {
        let start = date("2026-08-30T00:00:00+09:00")
        let dates = PlanEditor.dayDates(startingOn: start, count: 3, calendar: calendar)
        #expect(dates == ["2026-08-30", "2026-08-31", "2026-09-01"])
    }

    @Test func 日数0以下は空を返す() {
        let start = date("2026-08-30T00:00:00+09:00")
        #expect(PlanEditor.dayDates(startingOn: start, count: 0, calendar: calendar).isEmpty)
    }

    @Test func nextDateは年末も跨げる() {
        #expect(PlanEditor.nextDate(after: "2026-12-31", calendar: calendar) == "2027-01-01")
        #expect(PlanEditor.nextDate(after: "壊れた値", calendar: calendar) == nil)
    }

    @Test func parseDateとdateStringは往復する() {
        let parsed = PlanEditor.parseDate("2026-09-01", calendar: calendar)
        #expect(parsed != nil)
        #expect(PlanEditor.dateString(parsed!, calendar: calendar) == "2026-09-01")
    }

    // MARK: - 旅行の作成・日の追加

    @Test func makeTripは日別プランを紐付けたプラン中の旅行を作る() {
        let now = date("2026-08-21T10:00:00+09:00")
        let made = PlanEditor.makeTrip(
            title: "松本旅行",
            transport: "car",
            startDate: date("2026-09-01T00:00:00+09:00"),
            dayCount: 2,
            calendar: calendar,
            now: now
        )
        #expect(made.trip.title == "松本旅行")
        #expect(made.trip.transport == "car")
        #expect(made.trip.startedAt == nil)  // プラン段階(未出発)
        #expect(made.trip.updatedAt == now)
        #expect(made.trip.needsSync)
        #expect(made.days.map(\.date) == ["2026-09-01", "2026-09-02"])
        #expect(made.days.allSatisfy { $0.trip === made.trip })
        #expect(made.days.allSatisfy { $0.needsSync })
    }

    @Test func addedDayは最終日の翌日を追加する() {
        let trip = TripEntity(title: "t")
        trip.days = [
            TripDayEntity(date: "2026-08-31"),
            TripDayEntity(date: "2026-08-30"),
        ]
        let added = PlanEditor.addedDay(to: trip, calendar: calendar)
        #expect(added?.date == "2026-09-01")
    }

    @Test func addedDayは日が無ければ開始日で1日目を作る() {
        let trip = TripEntity(title: "t", startedAt: date("2026-09-05T09:00:00+09:00"))
        let added = PlanEditor.addedDay(to: trip, calendar: calendar)
        #expect(added?.date == "2026-09-05")
    }

    @Test func addedDayは未出発で日が無ければnowの日付で作る() {
        let trip = TripEntity(title: "t")
        let added = PlanEditor.addedDay(
            to: trip,
            calendar: calendar,
            now: date("2026-08-21T10:00:00+09:00")
        )
        #expect(added?.date == "2026-08-21")
    }

    @Test func addedDayは削除済みの日を最終日とみなさない() {
        let trip = TripEntity(title: "t")
        let deleted = TripDayEntity(date: "2026-09-03")
        deleted.deletedAt = Date()
        trip.days = [TripDayEntity(date: "2026-09-01"), deleted]
        let added = PlanEditor.addedDay(to: trip, calendar: calendar)
        #expect(added?.date == "2026-09-02")
    }

    // MARK: - 削除(tombstone)

    @Test func 日の削除はチェックポイントも道連れにする() {
        let now = date("2026-08-21T10:00:00+09:00")
        let day = TripDayEntity(date: "2026-09-01")
        let checkpoint = CheckpointEntity(type: .cafe, name: "喫茶店")
        let alreadyDeleted = CheckpointEntity(type: .other, name: "削除済み")
        let deletedBefore = date("2026-08-20T00:00:00+09:00")
        alreadyDeleted.deletedAt = deletedBefore
        day.checkpoints = [checkpoint, alreadyDeleted]

        PlanEditor.delete(day, now: now)

        #expect(day.deletedAt == now)
        #expect(day.needsSync)
        #expect(checkpoint.deletedAt == now)
        #expect(checkpoint.needsSync)
        // 既に削除済みの行は触らない(updatedAt を進めて LWW を乱さない)
        #expect(alreadyDeleted.deletedAt == deletedBefore)
    }

    // MARK: - 並び順

    @Test func nextSortOrderは削除済みを除いた最大の次を返す() {
        let day = TripDayEntity(date: "2026-09-01")
        #expect(PlanEditor.nextSortOrder(in: day) == 0)

        let first = CheckpointEntity(type: .sightseeing, name: "a", sortOrder: 0)
        let deleted = CheckpointEntity(type: .sightseeing, name: "b", sortOrder: 5)
        deleted.deletedAt = Date()
        let second = CheckpointEntity(type: .sightseeing, name: "c", sortOrder: 3)
        day.checkpoints = [first, deleted, second]
        #expect(PlanEditor.nextSortOrder(in: day) == 4)
    }

    @Test func applyOrderは位置が変わった行だけ更新する() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let a = CheckpointEntity(type: .sightseeing, name: "a", sortOrder: 0, updatedAt: old)
        let b = CheckpointEntity(type: .sightseeing, name: "b", sortOrder: 1, updatedAt: old)
        let c = CheckpointEntity(type: .sightseeing, name: "c", sortOrder: 2, updatedAt: old)
        for checkpoint in [a, b, c] {
            checkpoint.needsSync = false
        }

        // b を先頭へ移動 → [b, a, c]
        PlanEditor.applyOrder([b, a, c], now: now)

        #expect(b.sortOrder == 0 && a.sortOrder == 1 && c.sortOrder == 2)
        #expect(b.updatedAt == now && b.needsSync)
        #expect(a.updatedAt == now && a.needsSync)
        // 位置が変わっていない行は触らない
        #expect(c.updatedAt == old && !c.needsSync)
    }
}
