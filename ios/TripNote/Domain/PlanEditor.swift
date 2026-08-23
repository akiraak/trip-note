import Foundation

/// プラン(trip_days / checkpoints)を編集する純粋ロジック。
/// ModelContext には触れない(挿入・保存は呼び出し側で行う)ため、
/// unmanaged なエンティティだけでテストできる。
/// 同期対象フィールドを変更した行は updatedAt を更新し needsSync を立てる(LWW の基準)。
enum PlanEditor {
    /// trip_days.date と同じ YYYY-MM-DD 形式に変換する
    static func dateString(_ date: Date, calendar: Calendar = .current) -> String {
        formatter(calendar).string(from: date)
    }

    /// YYYY-MM-DD をその日の 0 時(カレンダーのタイムゾーン)として解釈する
    static func parseDate(_ dateString: String, calendar: Calendar = .current) -> Date? {
        formatter(calendar).date(from: dateString)
    }

    /// 開始日から連続した日数分の日付(YYYY-MM-DD)を返す
    static func dayDates(
        startingOn start: Date,
        count: Int,
        calendar: Calendar = .current
    ) -> [String] {
        guard count > 0 else { return [] }
        return (0..<count).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: start)
                .map { dateString($0, calendar: calendar) }
        }
    }

    /// 翌日の日付(YYYY-MM-DD)を返す
    static func nextDate(after dateString: String, calendar: Calendar = .current) -> String? {
        guard
            let date = parseDate(dateString, calendar: calendar),
            let next = calendar.date(byAdding: .day, value: 1, to: date)
        else { return nil }
        return Self.dateString(next, calendar: calendar)
    }

    /// trip_days の表示や AI 候補出しに使う HH:mm 形式に変換する
    static func timeString(_ date: Date, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    /// 出発地(1 日目の departure チェックポイントになる)。
    /// 現在地から設定した場合は座標付き、手入力は座標なし(地域だけ決定)
    struct DeparturePlace {
        let name: String
        let latitude: Double?
        let longitude: Double?

        init(name: String, latitude: Double? = nil, longitude: Double? = nil) {
            self.name = name
            self.latitude = latitude
            self.longitude = longitude
        }
    }

    /// プラン段階の旅行と 1 日目の trip_day、出発地チェックポイントを作る(挿入は呼び出し側)。
    /// startedAt は nil のまま。日数は作成時には決めず、
    /// AI 候補の採用や「日を追加」で後から増やす。
    /// 出発地は 1 日目の departure チェックポイント(planned_time = 出発日時)として表現する
    static func makeTrip(
        title: String,
        transport: String?,
        departureAt: Date,
        destination: String?,
        departurePlace: DeparturePlace? = nil,
        calendar: Calendar = .current,
        now: Date = Date()
    ) -> (trip: TripEntity, days: [TripDayEntity], checkpoints: [CheckpointEntity]) {
        let trip = TripEntity(title: title, updatedAt: now)
        trip.transport = transport
        trip.departureAt = departureAt
        trip.destination = destination
        let firstDay = TripDayEntity(
            date: dateString(departureAt, calendar: calendar),
            updatedAt: now,
            trip: trip
        )
        var checkpoints: [CheckpointEntity] = []
        if let departurePlace {
            checkpoints.append(
                CheckpointEntity(
                    type: .departure,
                    name: departurePlace.name,
                    latitude: departurePlace.latitude,
                    longitude: departurePlace.longitude,
                    plannedTime: departureAt,
                    sortOrder: 0,
                    updatedAt: now,
                    trip: trip,
                    tripDay: firstDay
                )
            )
        }
        return (trip, [firstDay], checkpoints)
    }

    /// 最終日の翌日の trip_day を作る(挿入は呼び出し側)。
    /// 日が 1 つも無ければ startedAt(未出発なら departureAt ?? now)の日付で 1 日目を作る
    static func addedDay(
        to trip: TripEntity,
        calendar: Calendar = .current,
        now: Date = Date()
    ) -> TripDayEntity? {
        let date: String
        if let last = trip.sortedDays.last {
            guard let next = nextDate(after: last.date, calendar: calendar) else { return nil }
            date = next
        } else {
            date = dateString(trip.startedAt ?? trip.departureAt ?? now, calendar: calendar)
        }
        return TripDayEntity(date: date, updatedAt: now, trip: trip)
    }

    /// 今日以降(当日を含む)のプラン日。すべて過去日なら全日を返す
    /// (終了した旅行・過去の旅行でトップ地図が空にならないためのフォールバック)
    static func upcomingDays(
        of trip: TripEntity,
        from now: Date = Date(),
        calendar: Calendar = .current
    ) -> [TripDayEntity] {
        let days = trip.sortedDays
        let today = dateString(now, calendar: calendar)
        // date は YYYY-MM-DD なので文字列比較で日付順になる
        let upcoming = days.filter { $0.date >= today }
        return upcoming.isEmpty ? days : upcoming
    }

    /// 旅行を削除する(tombstone)。ぶら下がる日・チェックポイントも道連れにする。
    /// location_points / media は不変(tombstone を持たない)ため触らない
    /// (親 trip の tombstone で非表示になる)
    static func delete(_ trip: TripEntity, now: Date = Date()) {
        for day in trip.days where day.deletedAt == nil {
            delete(day, now: now)
        }
        // 日との関連が切れたチェックポイントも取りこぼさない
        for checkpoint in trip.checkpoints
        where checkpoint.deletedAt == nil && checkpoint.tripDay == nil {
            delete(checkpoint, now: now)
        }
        trip.isRecordingActive = false
        trip.deletedAt = now
        trip.updatedAt = now
        trip.needsSync = true
    }

    /// 日を削除する(tombstone)。ぶら下がるチェックポイントも道連れにする
    static func delete(_ day: TripDayEntity, now: Date = Date()) {
        for checkpoint in day.checkpoints where checkpoint.deletedAt == nil {
            delete(checkpoint, now: now)
        }
        day.deletedAt = now
        day.updatedAt = now
        day.needsSync = true
    }

    /// チェックポイントを削除する(tombstone)
    static func delete(_ checkpoint: CheckpointEntity, now: Date = Date()) {
        checkpoint.deletedAt = now
        checkpoint.updatedAt = now
        checkpoint.needsSync = true
    }

    /// 新規チェックポイントの表示順(その日の末尾)
    static func nextSortOrder(in day: TripDayEntity) -> Int {
        let orders = day.checkpoints.filter { $0.deletedAt == nil }.map(\.sortOrder)
        return orders.max().map { $0 + 1 } ?? 0
    }

    /// その日の末尾に入れる新規チェックポイント(挿入・保存は呼び出し側)。
    /// 共有された場所・リンクの結果など「名前 + 種別(+ 座標)」が決まっているときに使う
    static func makeCheckpoint(
        name: String,
        type: CheckpointType,
        latitude: Double?,
        longitude: Double?,
        in day: TripDayEntity
    ) -> CheckpointEntity {
        CheckpointEntity(
            type: type,
            name: name,
            latitude: latitude,
            longitude: longitude,
            sortOrder: nextSortOrder(in: day),
            trip: day.trip,
            tripDay: day
        )
    }

    /// 並べ替え後の配列を受け取り、位置が変わった行だけ sort_order を振り直す
    /// (変わらない行の updatedAt を無駄に進めて LWW で他方の編集を潰さないため)
    static func applyOrder(_ ordered: [CheckpointEntity], now: Date = Date()) {
        for (index, checkpoint) in ordered.enumerated() where checkpoint.sortOrder != index {
            checkpoint.sortOrder = index
            checkpoint.updatedAt = now
            checkpoint.needsSync = true
        }
    }

    /// AI 提案を旅行に採用する(挿入・保存は呼び出し側)。
    /// 同じ日付の日が既にあればそこへチェックポイントを末尾追記し(title は上書きしない)、
    /// 無ければ日を作る。チェックポイントは AI の概算座標付きで入れ(無ければ nil)、
    /// あとから Google Maps のリンクで具体化したら上書きされる。
    /// 戻り値は新規作成したエンティティ(呼び出し側で insert する)
    static func adopt(
        _ suggestion: AIPlanSuggestion,
        into trip: TripEntity,
        now: Date = Date()
    ) -> (days: [TripDayEntity], checkpoints: [CheckpointEntity]) {
        var newDays: [TripDayEntity] = []
        var newCheckpoints: [CheckpointEntity] = []
        // 未挿入のエンティティは関係の逆参照(day.checkpoints)が更新されないため、
        // 採番はここで日付ごとに数える
        var nextOrder: [String: Int] = [:]
        let existingDays = trip.sortedDays
        for suggested in suggestion.days {
            let day: TripDayEntity
            if let found = existingDays.first(where: { $0.date == suggested.date }) {
                day = found
            } else if let created = newDays.first(where: { $0.date == suggested.date }) {
                day = created
            } else {
                day = TripDayEntity(
                    date: suggested.date,
                    title: suggested.title.isEmpty ? nil : suggested.title,
                    updatedAt: now,
                    trip: trip
                )
                newDays.append(day)
            }
            var order = nextOrder[suggested.date] ?? nextSortOrder(in: day)
            for checkpoint in suggested.checkpoints {
                let name = checkpoint.name.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { continue }
                // 概算座標は片方だけなら両方捨てる
                let hasCoords = checkpoint.latitude != nil && checkpoint.longitude != nil
                newCheckpoints.append(
                    CheckpointEntity(
                        type: checkpoint.type,
                        name: name,
                        latitude: hasCoords ? checkpoint.latitude : nil,
                        longitude: hasCoords ? checkpoint.longitude : nil,
                        note: checkpoint.note,
                        sortOrder: order,
                        updatedAt: now,
                        trip: trip,
                        tripDay: day
                    )
                )
                order += 1
            }
            nextOrder[suggested.date] = order
        }
        return (newDays, newCheckpoints)
    }

    /// AI の日数・宿泊地候補を旅行に採用する(挿入・保存は呼び出し側)。
    /// 1 日目(既存の最初の日 ?? departureAt ?? now)から dayCount 分の連続した日を
    /// 揃え(既存の日付は再利用)、最終日に目的地の到着チェックポイント
    /// (trip.destination + 概算座標)を、n 泊目の宿泊チェックポイントを n 日目に
    /// 末尾追記する。チェックポイントは AI の概算座標付きで入れ(無ければ nil)、
    /// あとから Google Maps のリンクで具体化したら上書きされる。
    /// 既存行の updatedAt は進めない(LWW で他方の編集を潰さないため)
    static func adopt(
        _ candidate: AITripOutlineCandidate,
        into trip: TripEntity,
        destinationLatitude: Double? = nil,
        destinationLongitude: Double? = nil,
        calendar: Calendar = .current,
        now: Date = Date()
    ) -> (days: [TripDayEntity], checkpoints: [CheckpointEntity]) {
        let existingDays = trip.sortedDays
        let start = existingDays.first.flatMap { parseDate($0.date, calendar: calendar) }
            ?? trip.departureAt
            ?? now
        let dates = dayDates(startingOn: start, count: candidate.dayCount, calendar: calendar)
        var newDays: [TripDayEntity] = []
        var dayByDate: [String: TripDayEntity] = [:]
        for date in dates {
            if let found = existingDays.first(where: { $0.date == date }) {
                dayByDate[date] = found
            } else {
                let day = TripDayEntity(date: date, updatedAt: now, trip: trip)
                newDays.append(day)
                dayByDate[date] = day
            }
        }
        var newCheckpoints: [CheckpointEntity] = []
        // 未挿入の日は逆参照(day.checkpoints)が更新されないため、採番は日付ごとに数える
        var nextOrder: [String: Int] = [:]
        func appendOrder(for date: String, in day: TripDayEntity) -> Int {
            let order = nextOrder[date] ?? nextSortOrder(in: day)
            nextOrder[date] = order + 1
            return order
        }
        // 最終日に目的地の到着チェックポイント(同日に宿泊があれば「到着 → 宿泊」の順)
        let destinationName = trip.destination?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !destinationName.isEmpty,
           let lastDate = dates.last,
           let lastDay = dayByDate[lastDate] {
            let hasCoords = destinationLatitude != nil && destinationLongitude != nil
            newCheckpoints.append(
                CheckpointEntity(
                    type: .destination,
                    name: destinationName,
                    latitude: hasCoords ? destinationLatitude : nil,
                    longitude: hasCoords ? destinationLongitude : nil,
                    sortOrder: appendOrder(for: lastDate, in: lastDay),
                    updatedAt: now,
                    trip: trip,
                    tripDay: lastDay
                )
            )
        }
        // nights[n] = n+1 泊目 = n+1 日目の宿。日数を超える分は捨てる
        for (index, night) in candidate.nights.enumerated() {
            guard index < dates.count, let day = dayByDate[dates[index]] else { break }
            let name = night.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }
            // 概算座標は片方だけなら両方捨てる
            let hasCoords = night.latitude != nil && night.longitude != nil
            newCheckpoints.append(
                CheckpointEntity(
                    type: .lodging,
                    name: name,
                    latitude: hasCoords ? night.latitude : nil,
                    longitude: hasCoords ? night.longitude : nil,
                    note: night.note,
                    sortOrder: appendOrder(for: dates[index], in: day),
                    updatedAt: now,
                    trip: trip,
                    tripDay: day
                )
            )
        }
        return (newDays, newCheckpoints)
    }

    private static func formatter(_ calendar: Calendar) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
}
