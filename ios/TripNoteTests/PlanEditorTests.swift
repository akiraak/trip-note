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

    @Test func displayDateはロケールによらずAug25形式を返す() {
        #expect(PlanEditor.displayDate("2026-08-25", calendar: calendar) == "Aug 25")
        #expect(PlanEditor.displayDate("2026-09-05", calendar: calendar) == "Sep 5")
        // パースできない値はそのまま返す
        #expect(PlanEditor.displayDate("壊れた値", calendar: calendar) == "壊れた値")
    }

    @Test func parseDateとdateStringは往復する() {
        let parsed = PlanEditor.parseDate("2026-09-01", calendar: calendar)
        #expect(parsed != nil)
        #expect(PlanEditor.dateString(parsed!, calendar: calendar) == "2026-09-01")
    }

    // MARK: - 旅行の作成・日の追加

    @Test func timeStringはHHmm形式を返す() {
        let time = PlanEditor.timeString(date("2026-09-01T08:05:00+09:00"), calendar: calendar)
        #expect(time == "08:05")
    }

    @Test func makeTripは1日目だけを紐付けたプラン中の旅行を作る() {
        let now = date("2026-08-21T10:00:00+09:00")
        let departureAt = date("2026-09-01T08:30:00+09:00")
        let made = PlanEditor.makeTrip(
            title: "松本旅行",
            transport: "car",
            departureAt: departureAt,
            destination: "上高地",
            calendar: calendar,
            now: now
        )
        #expect(made.trip.title == "松本旅行")
        #expect(made.trip.transport == "car")
        #expect(made.trip.startedAt == nil)  // プラン段階(未出発)
        #expect(made.trip.departureAt == departureAt)
        #expect(made.trip.destination == "上高地")
        #expect(made.trip.updatedAt == now)
        #expect(made.trip.needsSync)
        #expect(made.days.map(\.date) == ["2026-09-01"])  // 日数は決めず出発日の 1 日のみ
        #expect(made.days.allSatisfy { $0.trip === made.trip })
        #expect(made.days.allSatisfy { $0.needsSync })
        #expect(made.checkpoints.isEmpty)  // 出発地なしならチェックポイントも作らない
    }

    @Test func makeTripは出発地を1日目のdepartureチェックポイントにする() {
        let now = date("2026-08-21T10:00:00+09:00")
        let departureAt = date("2026-09-01T08:30:00+09:00")
        let made = PlanEditor.makeTrip(
            title: "松本旅行",
            transport: nil,
            departureAt: departureAt,
            destination: nil,
            departurePlace: PlanEditor.DeparturePlace(
                name: "自宅",
                latitude: 35.681236,
                longitude: 139.767125
            ),
            calendar: calendar,
            now: now
        )
        #expect(made.checkpoints.count == 1)
        let checkpoint = made.checkpoints[0]
        #expect(checkpoint.type == .departure)
        #expect(checkpoint.name == "自宅")
        #expect(checkpoint.latitude == 35.681236)
        #expect(checkpoint.longitude == 139.767125)
        #expect(checkpoint.plannedTime == departureAt)  // 出発予定時刻
        #expect(checkpoint.sortOrder == 0)
        #expect(checkpoint.trip === made.trip)
        #expect(checkpoint.tripDay === made.days.first)
        #expect(checkpoint.needsSync)
    }

    @Test func makeTripの手入力の出発地は座標なしで作る() {
        let made = PlanEditor.makeTrip(
            title: "t",
            transport: nil,
            departureAt: date("2026-09-01T08:30:00+09:00"),
            destination: nil,
            departurePlace: PlanEditor.DeparturePlace(name: "松本駅"),
            calendar: calendar
        )
        #expect(made.checkpoints.first?.latitude == nil)
        #expect(made.checkpoints.first?.longitude == nil)
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

    @Test func addedDayは未出発で日が無ければ出発予定日で作る() {
        let trip = TripEntity(title: "t")
        trip.departureAt = date("2026-09-05T09:00:00+09:00")
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

    // MARK: - 今日以降の日(トップ地図の絞り込み)

    @Test func upcomingDaysは当日を含む今日以降の日を返す() {
        let trip = TripEntity(title: "t")
        trip.days = [
            TripDayEntity(date: "2026-08-21"),
            TripDayEntity(date: "2026-08-22"),
            TripDayEntity(date: "2026-08-23"),
        ]
        let days = PlanEditor.upcomingDays(
            of: trip,
            from: date("2026-08-22T15:00:00+09:00"),
            calendar: calendar
        )
        #expect(days.map(\.date) == ["2026-08-22", "2026-08-23"])
    }

    @Test func upcomingDaysはすべて過去日なら全日を返す() {
        let trip = TripEntity(title: "t")
        trip.days = [
            TripDayEntity(date: "2026-08-01"),
            TripDayEntity(date: "2026-08-02"),
        ]
        let days = PlanEditor.upcomingDays(
            of: trip,
            from: date("2026-08-22T00:00:00+09:00"),
            calendar: calendar
        )
        #expect(days.map(\.date) == ["2026-08-01", "2026-08-02"])
    }

    @Test func upcomingDaysは削除済みの日を含めない() {
        let trip = TripEntity(title: "t")
        let deleted = TripDayEntity(date: "2026-08-23")
        deleted.deletedAt = Date()
        trip.days = [TripDayEntity(date: "2026-08-22"), deleted]
        let days = PlanEditor.upcomingDays(
            of: trip,
            from: date("2026-08-22T00:00:00+09:00"),
            calendar: calendar
        )
        #expect(days.map(\.date) == ["2026-08-22"])
    }

    // MARK: - 削除(tombstone)

    @Test func 旅行の削除は日とチェックポイントも道連れにする() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let trip = TripEntity(title: "t", updatedAt: old)
        trip.isRecordingActive = true
        let day = TripDayEntity(date: "2026-09-01", updatedAt: old)
        let deletedDay = TripDayEntity(date: "2026-09-02", updatedAt: old)
        deletedDay.deletedAt = old
        trip.days = [day, deletedDay]
        let checkpoint = CheckpointEntity(type: .lodging, name: "宿", updatedAt: old)
        day.checkpoints = [checkpoint]
        trip.checkpoints = [checkpoint]

        PlanEditor.delete(trip, now: now)

        #expect(trip.deletedAt == now)
        #expect(trip.updatedAt == now)
        #expect(trip.needsSync)
        #expect(!trip.isRecordingActive)
        #expect(day.deletedAt == now)
        #expect(checkpoint.deletedAt == now)
        // 既に削除済みの日は触らない(updatedAt を進めて LWW を乱さない)
        #expect(deletedDay.deletedAt == old)
        #expect(deletedDay.updatedAt == old)
    }

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

    // MARK: - 途中の日の追加・削除(日付シフト)

    /// 日付シフトの検証用に「同期済み(needsSync = false)の日」を並べた旅行を作る。
    /// unmanaged では inverse relationship が張られないため両方向を明示的に繋ぐ
    private func makeTripWithDays(_ dates: [String], updatedAt: Date) -> (
        trip: TripEntity, days: [TripDayEntity]
    ) {
        let trip = TripEntity(title: "t", updatedAt: updatedAt)
        let days = dates.map { date -> TripDayEntity in
            let day = TripDayEntity(date: date, updatedAt: updatedAt, trip: trip)
            day.needsSync = false
            return day
        }
        trip.days = days
        return (trip, days)
    }

    private func makeCheckpoint(
        plannedTime: Date?,
        in day: TripDayEntity,
        updatedAt: Date
    ) -> CheckpointEntity {
        let checkpoint = CheckpointEntity(
            type: .lodging,
            name: "宿",
            plannedTime: plannedTime,
            updatedAt: updatedAt,
            tripDay: day
        )
        checkpoint.needsSync = false
        day.checkpoints.append(checkpoint)
        return checkpoint
    }

    @Test func insertedDayは翌日を差し込み後続の日とplannedTimeを1日ずらす() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (_, days) = makeTripWithDays(
            ["2026-09-01", "2026-09-02", "2026-09-03"], updatedAt: old
        )
        let lodging = makeCheckpoint(
            plannedTime: date("2026-09-02T17:00:00+09:00"), in: days[1], updatedAt: old
        )

        let inserted = PlanEditor.insertedDay(after: days[0], calendar: calendar, now: now)

        #expect(inserted?.date == "2026-09-02")
        #expect(inserted?.trip === days[0].trip)
        #expect(inserted?.updatedAt == now)
        // 起点の日は動かさない(updatedAt を進めて LWW を乱さない)
        #expect(days[0].date == "2026-09-01")
        #expect(days[0].updatedAt == old)
        #expect(!days[0].needsSync)
        #expect(days[1].date == "2026-09-03")
        #expect(days[1].updatedAt == now)
        #expect(days[1].needsSync)
        #expect(days[2].date == "2026-09-04")
        #expect(lodging.plannedTime == date("2026-09-03T17:00:00+09:00"))
        #expect(lodging.updatedAt == now)
        #expect(lodging.needsSync)
    }

    // MARK: - 出発日の変更にプランを追従させる

    @Test func departureShiftDaysは出発日の差だけずらす() {
        #expect(
            PlanEditor.departureShiftDays(
                from: date("2026-09-01T08:00:00+09:00"),
                to: date("2026-09-04T08:00:00+09:00"),
                firstDayDate: "2026-09-01",
                calendar: calendar
            ) == 3
        )
        // 前倒しはマイナス
        #expect(
            PlanEditor.departureShiftDays(
                from: date("2026-09-04T08:00:00+09:00"),
                to: date("2026-09-01T08:00:00+09:00"),
                firstDayDate: "2026-09-04",
                calendar: calendar
            ) == -3
        )
    }

    @Test func departureShiftDaysは時刻だけの変更ではずらさない() {
        #expect(
            PlanEditor.departureShiftDays(
                from: date("2026-09-01T08:00:00+09:00"),
                to: date("2026-09-01T21:30:00+09:00"),
                firstDayDate: "2026-09-01",
                calendar: calendar
            ) == 0
        )
    }

    @Test func departureShiftDaysは旧出発日が無ければ1日目を新しい出発日に合わせる() {
        #expect(
            PlanEditor.departureShiftDays(
                from: nil,
                to: date("2026-09-05T08:00:00+09:00"),
                firstDayDate: "2026-09-01",
                calendar: calendar
            ) == 4
        )
    }

    @Test func departureShiftDaysは出発日を消したときと日が無いときは0() {
        #expect(
            PlanEditor.departureShiftDays(
                from: date("2026-09-01T08:00:00+09:00"),
                to: nil,
                firstDayDate: "2026-09-01",
                calendar: calendar
            ) == 0
        )
        #expect(
            PlanEditor.departureShiftDays(
                from: date("2026-09-01T08:00:00+09:00"),
                to: date("2026-09-04T08:00:00+09:00"),
                firstDayDate: nil,
                calendar: calendar
            ) == 0
        )
    }

    @Test func planShiftNoticeは動く向きと日数を出す() {
        #expect(PlanEditor.planShiftNotice(days: 3) == "プランの日付も 3 日うしろへ動きます")
        #expect(PlanEditor.planShiftNotice(days: -2) == "プランの日付も 2 日まえへ動きます")
        #expect(PlanEditor.planShiftNotice(days: 0) == nil)
    }

    @Test func shiftAllDaysは全日とplannedTimeを動かす() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (trip, days) = makeTripWithDays(
            ["2026-09-01", "2026-09-02", "2026-09-03"], updatedAt: old
        )
        let lodging = makeCheckpoint(
            plannedTime: date("2026-09-01T17:00:00+09:00"), in: days[0], updatedAt: old
        )

        PlanEditor.shiftAllDays(of: trip, by: 2, calendar: calendar, now: now)

        #expect(days.map(\.date) == ["2026-09-03", "2026-09-04", "2026-09-05"])
        #expect(days.allSatisfy { $0.updatedAt == now && $0.needsSync })
        #expect(lodging.plannedTime == date("2026-09-03T17:00:00+09:00"))
        #expect(lodging.needsSync)
    }

    @Test func shiftAllDaysは0日なら何も触らない() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (trip, days) = makeTripWithDays(["2026-09-01", "2026-09-02"], updatedAt: old)

        PlanEditor.shiftAllDays(of: trip, by: 0, calendar: calendar, now: now)

        #expect(days.map(\.date) == ["2026-09-01", "2026-09-02"])
        #expect(days.allSatisfy { $0.updatedAt == old && !$0.needsSync })
    }

    @Test func insertedDayは最終日ではずらす対象が無い() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (_, days) = makeTripWithDays(["2026-09-01", "2026-09-02"], updatedAt: old)

        let inserted = PlanEditor.insertedDay(after: days[1], calendar: calendar, now: now)

        #expect(inserted?.date == "2026-09-03")
        #expect(days.allSatisfy { $0.updatedAt == old })
        #expect(days.allSatisfy { !$0.needsSync })
    }

    @Test func insertedDayは削除済みの日とチェックポイントをずらさない() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (_, days) = makeTripWithDays(
            ["2026-09-01", "2026-09-02", "2026-09-03"], updatedAt: old
        )
        days[1].deletedAt = old
        let plannedTime = date("2026-09-03T17:00:00+09:00")
        let deletedCheckpoint = makeCheckpoint(
            plannedTime: plannedTime, in: days[2], updatedAt: old
        )
        deletedCheckpoint.deletedAt = old

        _ = PlanEditor.insertedDay(after: days[0], calendar: calendar, now: now)

        #expect(days[1].date == "2026-09-02")
        #expect(days[1].updatedAt == old)
        #expect(days[2].date == "2026-09-04")
        #expect(deletedCheckpoint.plannedTime == plannedTime)
        #expect(deletedCheckpoint.updatedAt == old)
    }

    @Test func insertedDayはplannedTimeの無いチェックポイントを触らない() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (_, days) = makeTripWithDays(["2026-09-01", "2026-09-02"], updatedAt: old)
        let checkpoint = makeCheckpoint(plannedTime: nil, in: days[1], updatedAt: old)

        _ = PlanEditor.insertedDay(after: days[0], calendar: calendar, now: now)

        #expect(checkpoint.updatedAt == old)
        #expect(!checkpoint.needsSync)
    }

    @Test func deleteShiftingFollowingは後続の日とplannedTimeを1日前に詰める() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (_, days) = makeTripWithDays(
            ["2026-09-01", "2026-09-02", "2026-09-03"], updatedAt: old
        )
        let lodging = makeCheckpoint(
            plannedTime: date("2026-09-03T17:00:00+09:00"), in: days[2], updatedAt: old
        )
        let deletedCheckpoint = makeCheckpoint(
            plannedTime: date("2026-09-02T18:00:00+09:00"), in: days[1], updatedAt: old
        )

        PlanEditor.deleteShiftingFollowing(days[1], calendar: calendar, now: now)

        #expect(days[1].deletedAt == now)
        #expect(deletedCheckpoint.deletedAt == now)
        // 消した日自身の日付は動かさない(tombstone なので表示されない)
        #expect(days[1].date == "2026-09-02")
        #expect(days[0].date == "2026-09-01")
        #expect(days[0].updatedAt == old)
        #expect(days[2].date == "2026-09-02")
        #expect(lodging.plannedTime == date("2026-09-02T17:00:00+09:00"))
        #expect(lodging.needsSync)
    }

    @Test func deleteShiftingFollowingは最終日ではずらさない() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (_, days) = makeTripWithDays(["2026-09-01", "2026-09-02"], updatedAt: old)

        PlanEditor.deleteShiftingFollowing(days[1], calendar: calendar, now: now)

        #expect(days[0].date == "2026-09-01")
        #expect(days[0].updatedAt == old)
        #expect(!days[0].needsSync)
    }

    @Test func deleteShiftingFollowingは1日目を消しても先頭の日付を保つ() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let (trip, days) = makeTripWithDays(
            ["2026-09-01", "2026-09-02", "2026-09-03"], updatedAt: old
        )

        PlanEditor.deleteShiftingFollowing(days[0], calendar: calendar, now: now)

        #expect(trip.sortedDays.map(\.date) == ["2026-09-01", "2026-09-02"])
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

    // MARK: - AI 提案の採用

    private func suggestion(_ days: [AISuggestedDay]) -> AIPlanSuggestion {
        AIPlanSuggestion(days: days)
    }

    @Test func adoptは日とチェックポイントを座標未定で作る() {
        let now = date("2026-08-21T10:00:00+09:00")
        let trip = TripEntity(title: "t")
        let made = PlanEditor.adopt(
            suggestion([
                AISuggestedDay(
                    date: "2026-09-01",
                    title: "松本周辺を観光して泊",
                    area: "松本市",
                    checkpoints: [
                        AISuggestedCheckpoint(typeRawValue: "departure", name: "東京駅", note: nil, latitude: nil, longitude: nil),
                        AISuggestedCheckpoint(typeRawValue: "sightseeing", name: "松本城", note: "国宝", latitude: nil, longitude: nil),
                    ]
                ),
                AISuggestedDay(
                    date: "2026-09-02",
                    title: "帰路",
                    area: "松本市",
                    checkpoints: [
                        AISuggestedCheckpoint(typeRawValue: "destination", name: "自宅", note: nil, latitude: nil, longitude: nil)
                    ]
                ),
            ]),
            into: trip,
            now: now
        )
        #expect(made.days.map(\.date) == ["2026-09-01", "2026-09-02"])
        #expect(made.days.map(\.title) == ["松本周辺を観光して泊", "帰路"])
        #expect(made.days.allSatisfy { $0.updatedAt == now && $0.needsSync })
        #expect(made.checkpoints.map(\.name) == ["東京駅", "松本城", "自宅"])
        #expect(made.checkpoints.map(\.sortOrder) == [0, 1, 0])
        #expect(made.checkpoints.allSatisfy { $0.latitude == nil && $0.longitude == nil })
        #expect(made.checkpoints.allSatisfy { $0.updatedAt == now && $0.needsSync })
        #expect(made.checkpoints[1].note == "国宝")
        #expect(made.checkpoints.first?.tripDay === made.days.first)
    }

    @Test func adoptは同じ日付の既存日へ末尾追記しtitleを保つ() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let trip = TripEntity(title: "t")
        let existing = TripDayEntity(date: "2026-09-01", title: "既存タイトル", updatedAt: old)
        existing.checkpoints = [CheckpointEntity(type: .sightseeing, name: "既存", sortOrder: 0)]
        trip.days = [existing]

        let made = PlanEditor.adopt(
            suggestion([
                AISuggestedDay(
                    date: "2026-09-01",
                    title: "新タイトル",
                    area: "松本市",
                    checkpoints: [
                        AISuggestedCheckpoint(typeRawValue: "cafe", name: "喫茶店", note: nil, latitude: nil, longitude: nil)
                    ]
                )
            ]),
            into: trip,
            now: now
        )
        #expect(made.days.isEmpty)  // 日は増えない
        #expect(existing.title == "既存タイトル")
        #expect(existing.updatedAt == old)  // 既存日は触らない
        #expect(made.checkpoints.map(\.name) == ["喫茶店"])
        #expect(made.checkpoints.first?.sortOrder == 1)  // 既存の末尾に続く
        #expect(made.checkpoints.first?.tripDay === existing)
    }

    @Test func adoptは概算座標を保存し片方だけなら捨てる() {
        let trip = TripEntity(title: "t")
        let made = PlanEditor.adopt(
            suggestion([
                AISuggestedDay(
                    date: "2026-09-01",
                    title: "初日",
                    area: "松本市",
                    checkpoints: [
                        AISuggestedCheckpoint(
                            typeRawValue: "sightseeing", name: "松本城", note: nil,
                            latitude: 36.2381, longitude: 137.969
                        ),
                        AISuggestedCheckpoint(
                            typeRawValue: "lodging", name: "宿", note: nil,
                            latitude: 36.26, longitude: nil
                        ),
                    ]
                )
            ]),
            into: trip
        )
        #expect(made.checkpoints[0].latitude == 36.2381)
        #expect(made.checkpoints[0].longitude == 137.969)
        #expect(made.checkpoints[1].latitude == nil)
        #expect(made.checkpoints[1].longitude == nil)
    }

    @Test func adoptは空の名前を読み飛ばす() {
        let trip = TripEntity(title: "t")
        let made = PlanEditor.adopt(
            suggestion([
                AISuggestedDay(
                    date: "2026-09-01",
                    title: "初日",
                    area: "松本市",
                    checkpoints: [
                        AISuggestedCheckpoint(typeRawValue: "cafe", name: "  ", note: nil, latitude: nil, longitude: nil),
                        AISuggestedCheckpoint(typeRawValue: "cafe", name: "喫茶店", note: nil, latitude: nil, longitude: nil),
                    ]
                )
            ]),
            into: trip
        )
        #expect(made.checkpoints.map(\.name) == ["喫茶店"])
        #expect(made.checkpoints.first?.sortOrder == 0)
    }

    // MARK: - AI 日数・宿泊地候補の採用

    @Test func adoptOutlineは日を揃えて各泊にlodgingを追記する() {
        let old = date("2026-08-20T00:00:00+09:00")
        let now = date("2026-08-21T10:00:00+09:00")
        let trip = TripEntity(title: "t")
        trip.departureAt = date("2026-09-01T08:30:00+09:00")
        let existing = TripDayEntity(date: "2026-09-01", updatedAt: old)
        trip.days = [existing]

        let candidate = AITripOutlineCandidate(
            dayCount: 3,
            title: "2泊3日でゆったり",
            nights: [
                AISuggestedNight(
                    area: "松本市街", name: "松本駅周辺のホテル", note: nil,
                    latitude: 36.2381, longitude: 137.969
                ),
                AISuggestedNight(area: "上高地", name: "上高地の宿", note: "要予約", latitude: 36.25, longitude: nil),
            ]
        )
        let made = PlanEditor.adopt(candidate, into: trip, calendar: calendar, now: now)

        #expect(made.days.map(\.date) == ["2026-09-02", "2026-09-03"])  // 1 日目は既存を再利用
        #expect(existing.updatedAt == old)  // 既存日は触らない
        #expect(made.checkpoints.map(\.name) == ["松本駅周辺のホテル", "上高地の宿"])
        #expect(made.checkpoints.allSatisfy { $0.type == .lodging })
        // 概算座標は保存する。片方だけなら両方捨てる
        #expect(made.checkpoints[0].latitude == 36.2381)
        #expect(made.checkpoints[0].longitude == 137.969)
        #expect(made.checkpoints[1].latitude == nil)
        #expect(made.checkpoints[1].longitude == nil)
        #expect(made.checkpoints.allSatisfy { $0.updatedAt == now && $0.needsSync })
        #expect(made.checkpoints[0].tripDay === existing)  // 1 泊目は 1 日目
        #expect(made.checkpoints[1].tripDay === made.days.first)  // 2 泊目は 2 日目
        #expect(made.checkpoints[1].note == "要予約")
    }

    @Test func adoptOutlineは日が無ければ出発予定日から日を作る() {
        let trip = TripEntity(title: "t")
        trip.departureAt = date("2026-09-01T08:30:00+09:00")
        let candidate = AITripOutlineCandidate(
            dayCount: 2,
            title: "1泊2日",
            nights: [AISuggestedNight(area: "松本", name: "松本の宿", note: nil, latitude: nil, longitude: nil)]
        )
        let made = PlanEditor.adopt(candidate, into: trip, calendar: calendar)
        #expect(made.days.map(\.date) == ["2026-09-01", "2026-09-02"])
        #expect(made.checkpoints.first?.tripDay === made.days.first)
    }

    @Test func adoptOutlineは最終日に目的地チェックポイントを作る() {
        let trip = TripEntity(title: "t")
        trip.departureAt = date("2026-09-01T08:30:00+09:00")
        trip.destination = "シカゴ"
        let candidate = AITripOutlineCandidate(
            dayCount: 3,
            title: "2泊3日",
            nights: [
                AISuggestedNight(area: "a", name: "宿1", note: nil, latitude: nil, longitude: nil),
                AISuggestedNight(area: "b", name: "宿2", note: nil, latitude: nil, longitude: nil),
            ]
        )
        let made = PlanEditor.adopt(
            candidate,
            into: trip,
            destinationLatitude: 41.8781,
            destinationLongitude: -87.6298,
            calendar: calendar
        )
        let destination = made.checkpoints.first { $0.type == .destination }
        #expect(destination?.name == "シカゴ")
        #expect(destination?.latitude == 41.8781)
        #expect(destination?.longitude == -87.6298)
        #expect(destination?.tripDay?.date == "2026-09-03")  // 最終日
    }

    @Test func adoptOutlineは最終日の到着を宿泊より前に並べる() {
        // 目的地に泊まる候補(nights == dayCount)では「到着 → 宿泊」の順になる
        let trip = TripEntity(title: "t")
        trip.departureAt = date("2026-09-01T08:30:00+09:00")
        trip.destination = "シカゴ"
        let candidate = AITripOutlineCandidate(
            dayCount: 2,
            title: "シカゴ泊",
            nights: [
                AISuggestedNight(area: "途中", name: "宿1", note: nil, latitude: nil, longitude: nil),
                AISuggestedNight(area: "シカゴ", name: "シカゴの宿", note: nil, latitude: nil, longitude: nil),
            ]
        )
        let made = PlanEditor.adopt(candidate, into: trip, calendar: calendar)
        let lastDayCheckpoints = made.checkpoints.filter { $0.tripDay?.date == "2026-09-02" }
        #expect(lastDayCheckpoints.map(\.typeRawValue) == ["destination", "lodging"])
        #expect(lastDayCheckpoints.map(\.sortOrder) == [0, 1])
    }

    @Test func adoptOutlineは日数を超える泊と空の名前を捨てる() {
        let trip = TripEntity(title: "t")
        trip.departureAt = date("2026-09-01T08:30:00+09:00")
        let candidate = AITripOutlineCandidate(
            dayCount: 1,
            title: "日帰り",
            nights: [
                AISuggestedNight(area: "a", name: "  ", note: nil, latitude: nil, longitude: nil),  // 空の名前
                AISuggestedNight(area: "b", name: "余分な宿", note: nil, latitude: nil, longitude: nil),  // 日数超え
            ]
        )
        let made = PlanEditor.adopt(candidate, into: trip, calendar: calendar)
        #expect(made.days.map(\.date) == ["2026-09-01"])
        #expect(made.checkpoints.isEmpty)
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
