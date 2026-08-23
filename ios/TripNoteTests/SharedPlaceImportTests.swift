import Foundation
import Testing
@testable import TripNote

struct SharedPlaceImportTests {
    // unmanaged なエンティティ(コンテナ未挿入)。days の逆参照は更新されないので
    // trip.days に直接入れる
    private func makeTrip(title: String, startedAt: Date?, dates: [String]) -> TripEntity {
        let trip = TripEntity(title: title, startedAt: startedAt)
        trip.days = dates.map { TripDayEntity(date: $0, trip: trip) }
        return trip
    }

    @Test func 既定の旅行は一覧の先頭() {
        let planning = makeTrip(title: "プラン中", startedAt: nil, dates: ["2026-09-01"])
        let older = makeTrip(title: "前の旅行", startedAt: Date(timeIntervalSince1970: 0), dates: [])
        #expect(SharedPlaceImport.defaultTrip(in: [planning, older])?.title == "プラン中")
        #expect(SharedPlaceImport.defaultTrip(in: []) == nil)
    }

    @Test func 進行中の旅行で今日が日程にあれば今日が既定の日() {
        let trip = makeTrip(
            title: "進行中", startedAt: Date(),
            dates: ["2026-09-01", "2026-09-02", "2026-09-03"]
        )
        #expect(SharedPlaceImport.defaultDay(in: trip, today: "2026-09-02")?.date == "2026-09-02")
        // 日程外なら最初の日
        #expect(SharedPlaceImport.defaultDay(in: trip, today: "2026-09-10")?.date == "2026-09-01")
    }

    @Test func プラン中の旅行は今日に関係なく最初の日() {
        let trip = makeTrip(title: "プラン中", startedAt: nil, dates: ["2026-09-02", "2026-09-01"])
        #expect(SharedPlaceImport.defaultDay(in: trip, today: "2026-09-02")?.date == "2026-09-01")
    }

    @Test func 削除済みの日は既定にならず日が無ければnil() {
        let trip = makeTrip(title: "x", startedAt: nil, dates: ["2026-09-01", "2026-09-02"])
        trip.days[0].deletedAt = Date()
        #expect(SharedPlaceImport.defaultDay(in: trip, today: "2026-09-01")?.date == "2026-09-02")
        let empty = makeTrip(title: "y", startedAt: nil, dates: [])
        #expect(SharedPlaceImport.defaultDay(in: empty, today: "2026-09-01") == nil)
    }

    @Test func 名前はサーバの結果を優先し無ければ共有テキストの1行目() {
        let share = PendingShare(text: "松本城\nhttps://maps.app.goo.gl/a", url: nil)
        let resolved = ResolvedGoogleMapsPlace(
            name: "Matsumoto Castle", latitude: 36.2, longitude: 137.9,
            precision: "pin", resolvedUrl: "https://www.google.com/maps/place/x"
        )
        #expect(SharedPlaceImport.placeName(resolved: resolved, share: share) == "Matsumoto Castle")
        let unnamed = ResolvedGoogleMapsPlace(
            name: nil, latitude: 36.2, longitude: 137.9, precision: "pin", resolvedUrl: "u"
        )
        #expect(SharedPlaceImport.placeName(resolved: unnamed, share: share) == "松本城")
        #expect(SharedPlaceImport.placeName(resolved: nil, share: share) == "松本城")
        let urlOnly = PendingShare(text: nil, url: "https://maps.app.goo.gl/a")
        #expect(SharedPlaceImport.placeName(resolved: nil, share: urlOnly) == "")
    }
}
