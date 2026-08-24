import Foundation

/// EXIF の撮影日時を絶対時刻に直すロジック(純関数)。
///
/// EXIF の `DateTimeOriginal` はタイムゾーンを持たない壁時計時刻なので、そのまま端末の
/// タイムゾーンで解釈すると「旅行先で撮って帰宅後に取り込んだ写真」が時差分ずれる。
/// オフセットを次の順で補う。
///   1. `OffsetTimeOriginal`(EXIF 2.31。iPhone で撮った写真には入っている)
///   2. GPS の UTC 時刻との差から推定する
///   3. 端末のタイムゾーン(どちらも無い写真向けのフォールバック)
enum MediaCaptureTime {
    /// 実在するタイムゾーンオフセットの範囲(UTC-12:00 〜 UTC+14:00)
    private static let minOffsetSeconds = -12 * 3600
    private static let maxOffsetSeconds = 14 * 3600
    /// 推定オフセットを丸める単位(実在するオフセットはすべて 15 分の倍数)
    private static let offsetStepSeconds = 15 * 60
    /// 測位時刻と撮影時刻のずれとして許す上限。丸めた結果からこれ以上離れている
    /// (= きれいなオフセットにならない)なら、古い測位とみなして推定に使わない
    private static let gpsDriftToleranceSeconds: Double = 120

    /// EXIF の各値から撮影時刻を作る。`dateTimeOriginal` が読めなければ nil。
    static func date(
        dateTimeOriginal: String,
        offsetTimeOriginal: String? = nil,
        gpsTimestamp: Date? = nil,
        fallbackTimeZone: TimeZone = .current
    ) -> Date? {
        if
            let seconds = offsetSeconds(from: offsetTimeOriginal),
            let timeZone = TimeZone(secondsFromGMT: seconds)
        {
            return parse(dateTimeOriginal, timeZone: timeZone)
        }
        if
            let gpsTimestamp,
            let seconds = inferredOffsetSeconds(dateTimeOriginal, gpsTimestamp: gpsTimestamp),
            let timeZone = TimeZone(secondsFromGMT: seconds)
        {
            return parse(dateTimeOriginal, timeZone: timeZone)
        }
        return parse(dateTimeOriginal, timeZone: fallbackTimeZone)
    }

    /// GPS の日付・時刻(いずれも UTC)を 1 つの Date にする。
    /// `GPSTimeStamp` は "18:44:36.00" のように秒に小数が付くことがある。
    static func gpsDate(dateStamp: String?, timeStamp: String?) -> Date? {
        guard let dateStamp, let timeStamp else { return nil }
        let seconds = timeStamp.split(separator: ".").first.map(String.init) ?? timeStamp
        return parse("\(dateStamp) \(seconds)", timeZone: .gmt)
    }

    /// "+09:00" / "-07:00" 形式のオフセットを秒に直す。空欄("   :  ")などは nil。
    static func offsetSeconds(from value: String?) -> Int? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        let sign: Int
        switch trimmed.first {
        case "+": sign = 1
        case "-": sign = -1
        default: return nil
        }
        let parts = trimmed.dropFirst().split(separator: ":")
        guard
            parts.count == 2,
            let hours = Int(parts[0]), let minutes = Int(parts[1]),
            (0..<60).contains(minutes)
        else { return nil }
        let seconds = sign * (hours * 3600 + minutes * 60)
        guard (minOffsetSeconds...maxOffsetSeconds).contains(seconds) else { return nil }
        return seconds
    }

    /// 壁時計時刻と GPS の UTC 時刻の差からオフセットを推定する。
    /// 測位と撮影の時間差が丸め単位に収まらない場合は推定できない(nil)。
    private static func inferredOffsetSeconds(
        _ dateTimeOriginal: String,
        gpsTimestamp: Date
    ) -> Int? {
        guard let naive = parse(dateTimeOriginal, timeZone: .gmt) else { return nil }
        let difference = naive.timeIntervalSince(gpsTimestamp)
        let rounded = (difference / Double(offsetStepSeconds)).rounded() * Double(offsetStepSeconds)
        guard
            abs(difference - rounded) <= gpsDriftToleranceSeconds,
            rounded >= Double(minOffsetSeconds), rounded <= Double(maxOffsetSeconds)
        else { return nil }
        return Int(rounded)
    }

    private static func parse(_ value: String, timeZone: TimeZone) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        formatter.timeZone = timeZone
        return formatter.date(from: value)
    }
}
