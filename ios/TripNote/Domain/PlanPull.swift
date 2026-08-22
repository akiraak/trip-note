import Foundation

/// pull したプラン系レコードをローカルエンティティへ反映する LWW ロジック。
/// 行単位の LWW: レコードの updated_at が新しいときだけ上書きする。
/// 同時刻は既存を保持(自分の push が pull で返ってきたときの無駄な更新を防ぐ)。
/// 反映した行はサーバ由来なので needsSync を下ろす。
/// ModelContext には触れない(挿入や親の解決は SyncEngine 側で行う)ため、
/// unmanaged なエンティティだけでテストできる
enum PlanPull {
    @discardableResult
    static func apply(_ record: TripPullRecord, to trip: TripEntity) -> Bool {
        guard record.updatedAt > trip.updatedAt else { return false }
        trip.title = record.title
        trip.startedAt = record.startedAt
        trip.endedAt = record.endedAt
        trip.transport = record.transport
        trip.updatedAt = record.updatedAt
        trip.deletedAt = record.deletedAt
        trip.needsSync = false
        return true
    }

    @discardableResult
    static func apply(_ record: TripDayPullRecord, to day: TripDayEntity) -> Bool {
        guard record.updatedAt > day.updatedAt else { return false }
        day.date = record.date
        day.title = record.title
        day.note = record.note
        day.updatedAt = record.updatedAt
        day.deletedAt = record.deletedAt
        day.needsSync = false
        return true
    }

    /// day には record.tripDayId を解決した親を渡す(別の日への移動もここで反映される)
    @discardableResult
    static func apply(
        _ record: CheckpointPullRecord,
        to checkpoint: CheckpointEntity,
        day: TripDayEntity
    ) -> Bool {
        guard record.updatedAt > checkpoint.updatedAt else { return false }
        checkpoint.typeRawValue = record.type
        checkpoint.name = record.name
        checkpoint.latitude = record.latitude
        checkpoint.longitude = record.longitude
        checkpoint.plannedTime = record.plannedTime
        checkpoint.note = record.note
        checkpoint.sortOrder = record.sortOrder
        checkpoint.updatedAt = record.updatedAt
        checkpoint.deletedAt = record.deletedAt
        checkpoint.tripDay = day
        checkpoint.needsSync = false
        return true
    }

    // MARK: - ローカルに無い行の生成(サーバ由来なので needsSync は下ろす)

    static func makeTrip(_ record: TripPullRecord) -> TripEntity {
        let trip = TripEntity(
            id: record.id,
            title: record.title,
            startedAt: record.startedAt,
            endedAt: record.endedAt,
            updatedAt: record.updatedAt
        )
        trip.transport = record.transport
        trip.deletedAt = record.deletedAt
        trip.needsSync = false
        return trip
    }

    static func makeDay(_ record: TripDayPullRecord, trip: TripEntity) -> TripDayEntity {
        let day = TripDayEntity(
            id: record.id,
            date: record.date,
            title: record.title,
            note: record.note,
            updatedAt: record.updatedAt,
            trip: trip
        )
        day.deletedAt = record.deletedAt
        day.needsSync = false
        return day
    }

    static func makeCheckpoint(
        _ record: CheckpointPullRecord,
        trip: TripEntity,
        day: TripDayEntity
    ) -> CheckpointEntity {
        let checkpoint = CheckpointEntity(
            id: record.id,
            type: CheckpointType(rawValue: record.type) ?? .other,
            name: record.name,
            latitude: record.latitude,
            longitude: record.longitude,
            plannedTime: record.plannedTime,
            note: record.note,
            sortOrder: record.sortOrder,
            updatedAt: record.updatedAt,
            trip: trip,
            tripDay: day
        )
        // 未知の type でもサーバの値を保持する(往復で other に化けさせない)
        checkpoint.typeRawValue = record.type
        checkpoint.deletedAt = record.deletedAt
        checkpoint.needsSync = false
        return checkpoint
    }
}
