import Foundation
import Testing
@testable import TripNote

struct MediaCaptureTimeTests {
    private func utc(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    private let tokyo = TimeZone(identifier: "Asia/Tokyo")!
    private let losAngeles = TimeZone(identifier: "America/Los_Angeles")!

    @Test func オフセットがあればそれで解釈する() {
        let date = MediaCaptureTime.date(
            dateTimeOriginal: "2026:08:24 18:44:36",
            offsetTimeOriginal: "+09:00",
            fallbackTimeZone: losAngeles
        )
        #expect(date == utc("2026-08-24T09:44:36Z"))
    }

    @Test func オフセットが無ければGPSのUTC時刻から推定する() {
        // 端末は日本のまま、写真は UTC-7 の現地で撮ったもの
        let date = MediaCaptureTime.date(
            dateTimeOriginal: "2026:08:24 11:44:36",
            offsetTimeOriginal: nil,
            gpsTimestamp: utc("2026-08-24T18:44:30Z"),
            fallbackTimeZone: tokyo
        )
        #expect(date == utc("2026-08-24T18:44:36Z"))
    }

    @Test func GPS時刻が撮影と離れすぎていれば推定に使わない() {
        // 古い測位が埋まっている場合。きれいなオフセットにならないので端末 TZ に落ちる
        let date = MediaCaptureTime.date(
            dateTimeOriginal: "2026:08:24 11:44:36",
            offsetTimeOriginal: nil,
            gpsTimestamp: utc("2026-08-24T18:52:00Z"),
            fallbackTimeZone: tokyo
        )
        #expect(date == utc("2026-08-24T02:44:36Z"))
    }

    @Test func 手がかりが無ければ端末のタイムゾーンで解釈する() {
        let date = MediaCaptureTime.date(
            dateTimeOriginal: "2026:08:24 11:44:36",
            fallbackTimeZone: losAngeles
        )
        #expect(date == utc("2026-08-24T18:44:36Z"))
    }

    @Test func 日時が読めなければnil() {
        #expect(MediaCaptureTime.date(dateTimeOriginal: "") == nil)
        #expect(MediaCaptureTime.date(dateTimeOriginal: "2026-08-24T11:44:36Z") == nil)
    }

    @Test func オフセット文字列を秒に直す() {
        #expect(MediaCaptureTime.offsetSeconds(from: "+09:00") == 9 * 3600)
        #expect(MediaCaptureTime.offsetSeconds(from: "-07:30") == -(7 * 3600 + 30 * 60))
        #expect(MediaCaptureTime.offsetSeconds(from: "+00:00") == 0)
    }

    @Test func 空欄や範囲外のオフセットは無視する() {
        // 撮影時に埋められなかった写真は空欄のまま入っていることがある
        #expect(MediaCaptureTime.offsetSeconds(from: nil) == nil)
        #expect(MediaCaptureTime.offsetSeconds(from: "") == nil)
        #expect(MediaCaptureTime.offsetSeconds(from: "   :  ") == nil)
        #expect(MediaCaptureTime.offsetSeconds(from: "+9") == nil)
        #expect(MediaCaptureTime.offsetSeconds(from: "+99:00") == nil)
        #expect(MediaCaptureTime.offsetSeconds(from: "+09:99") == nil)
    }

    @Test func GPSの日付と時刻をUTCの日時にする() {
        #expect(
            MediaCaptureTime.gpsDate(dateStamp: "2026:08:24", timeStamp: "18:44:36.00")
                == utc("2026-08-24T18:44:36Z")
        )
        #expect(
            MediaCaptureTime.gpsDate(dateStamp: "2026:08:24", timeStamp: "18:44:36")
                == utc("2026-08-24T18:44:36Z")
        )
        #expect(MediaCaptureTime.gpsDate(dateStamp: nil, timeStamp: "18:44:36") == nil)
        #expect(MediaCaptureTime.gpsDate(dateStamp: "2026:08:24", timeStamp: nil) == nil)
    }
}
