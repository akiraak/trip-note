import Foundation

/// 日単位の出発時刻とレグ所要時間(OSRM の durationS)から、各チェックポイントの
/// 到着予想時刻を導出する純ロジック。予想は保存せず表示時に計算する
/// (各 CP の plannedTime へ書き込むと updatedAt/needsSync が動いて LWW と同期を乱すため)。
/// PlanPull と同じく ModelContext には触れないので unmanaged なエンティティでテストできる
enum ArrivalEstimator {
    /// "HH:MM" の出発時刻を日付(YYYY-MM-DD)と合成して Date にする。
    /// plannedTime(Date)と同じ基準で比較・連鎖できるよう Calendar のタイムゾーンで解釈する
    static func departureDate(
        dayDate: String,
        departureTime: String?,
        calendar: Calendar = .current
    ) -> Date? {
        guard
            let departureTime,
            let date = PlanEditor.parseDate(dayDate, calendar: calendar)
        else { return nil }
        let parts = departureTime.split(separator: ":")
        guard
            parts.count == 2,
            let hour = Int(parts[0]), let minute = Int(parts[1]),
            (0..<24).contains(hour), (0..<60).contains(minute)
        else { return nil }
        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date)
    }

    /// checkpoints(sortOrder 順・tombstone 除外済み)の到着予想時刻を CP id で返す。
    /// 手入力 plannedTime のある CP は対象外(表示はそのまま plannedTime を使う)。
    /// 規則:
    /// - anchor は日の出発時刻(前泊地を出る時刻)から始まり、plannedTime のある CP で
    ///   その値に置き換えて再連鎖する(滞在時間はモデル化せず「その CP を出る時刻」扱い。
    ///   1 日目は出発 CP の plannedTime = trip.departureAt が自然に anchor になる)
    /// - 各 CP の予想 = anchor + anchor 以降のレグ所要時間(durationS)の累積
    /// - anchor が無い区間と未解決レグ(durationS 不明)以降は予想なし
    ///   (次の plannedTime 付き CP で再開する)
    /// - 座標なし CP は予想なし。レグはレグ組み立てと同様にそれを飛ばして連鎖を続ける
    static func estimates(
        dayDate: String,
        departureTime: String?,
        routeStart: RoutePoint?,
        checkpoints: [CheckpointEntity],
        resolvedLegs: [String: ResolvedRouteLeg],
        calendar: Calendar = .current
    ) -> [UUID: Date] {
        var anchor = departureDate(
            dayDate: dayDate, departureTime: departureTime, calendar: calendar
        )
        var accumulatedS: TimeInterval = 0
        var previous = routeStart
        var estimates: [UUID: Date] = [:]
        for checkpoint in checkpoints {
            var coordinate: RoutePoint?
            if let latitude = checkpoint.latitude, let longitude = checkpoint.longitude {
                coordinate = RoutePoint(latitude: latitude, longitude: longitude)
            }
            if let coordinate {
                if let previous {
                    let leg = RouteLeg(from: previous, to: coordinate)
                    if leg.isDegenerate {
                        // 丸め粒度で同一地点(レグ組み立てでも作られない)。所要 0 で連鎖を続ける
                    } else if let resolved = resolvedLegs[leg.key] {
                        accumulatedS += resolved.durationS
                    } else {
                        // 未解決レグ以降は予想を打ち切る(次の plannedTime で再アンカー)
                        anchor = nil
                    }
                }
                previous = coordinate
            }
            if let plannedTime = checkpoint.plannedTime {
                anchor = plannedTime
                accumulatedS = 0
            } else if coordinate != nil, let anchor {
                estimates[checkpoint.id] = anchor.addingTimeInterval(accumulatedS)
            }
        }
        return estimates
    }
}
