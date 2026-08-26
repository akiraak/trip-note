import Foundation

/// pull したプラン系レコードをローカルエンティティへ反映する LWW ロジック。
/// 行単位の LWW: レコードの updated_at が新しいときだけ上書きする。
/// 同時刻は既存を保持(自分の push が pull で返ってきたときの無駄な更新を防ぐ)。
/// 反映した行はサーバ由来なので needsSync を下ろす。
///
/// tombstone だけは LWW の外に置き、**削除は常に勝つ**ようにする
/// (削除の取り消し操作は無いので、これで表示できる行が減ることはない):
///   - 一度付いた deletedAt は解除しない
///   - レコードの updated_at が古くても、tombstone だけは取り込む
///     (ローカルで並べ替えなどをしていて updated_at が進んでいると、
///      サーバの削除が LWW で負けて永久に取り込まれなくなるため)
/// サーバ側 `/api/sync` も同じ規則
/// (docs/plans/deleted-checkpoint-on-map.md)。
///
/// ModelContext には触れない(挿入や親の解決は SyncEngine 側で行う)ため、
/// unmanaged なエンティティだけでテストできる
enum PlanPull {
    @discardableResult
    static func apply(_ record: TripPullRecord, to trip: TripEntity) -> Bool {
        if trip.deletedAt == nil { trip.deletedAt = record.deletedAt }
        guard record.updatedAt > trip.updatedAt else { return false }
        trip.title = record.title
        trip.startedAt = record.startedAt
        trip.endedAt = record.endedAt
        trip.transport = record.transport
        trip.departureAt = record.departureAt
        trip.destination = record.destination
        trip.updatedAt = record.updatedAt
        trip.needsSync = false
        return true
    }

    @discardableResult
    static func apply(_ record: TripDayPullRecord, to day: TripDayEntity) -> Bool {
        if day.deletedAt == nil { day.deletedAt = record.deletedAt }
        guard record.updatedAt > day.updatedAt else { return false }
        day.date = record.date
        day.title = record.title
        day.note = record.note
        day.departureTime = record.departureTime
        day.updatedAt = record.updatedAt
        day.needsSync = false
        return true
    }

    /// day には record.tripDayId を解決した親を渡す(別の日への移動もここで反映される)。
    /// 親の日が削除済みなら、生きたレコードが来ても削除済みのままにする(孤児を作らない)
    @discardableResult
    static func apply(
        _ record: CheckpointPullRecord,
        to checkpoint: CheckpointEntity,
        day: TripDayEntity
    ) -> Bool {
        if checkpoint.deletedAt == nil {
            checkpoint.deletedAt = record.deletedAt ?? day.deletedAt
        }
        guard record.updatedAt > checkpoint.updatedAt else { return false }
        checkpoint.typeRawValue = record.type
        checkpoint.name = record.name
        checkpoint.latitude = record.latitude
        checkpoint.longitude = record.longitude
        checkpoint.plannedTime = record.plannedTime
        checkpoint.note = record.note
        checkpoint.sortOrder = record.sortOrder
        checkpoint.updatedAt = record.updatedAt
        checkpoint.tripDay = day
        checkpoint.needsSync = false
        return true
    }

    /// 削除済みの日に残っている生きたチェックポイントを道連れにする(孤児を作らない)。
    /// 日の削除とチェックポイントの編集が別クライアントで前後し、チェックポイントの
    /// tombstone が LWW で負けたときの取りこぼしをここで揃える。
    /// サーバへも伝えたいので needsSync は立てる
    @discardableResult
    static func cascadeDelete(in day: TripDayEntity, now: Date = Date()) -> Int {
        guard let deletedAt = day.deletedAt else { return 0 }
        var count = 0
        for checkpoint in day.checkpoints where checkpoint.deletedAt == nil {
            checkpoint.deletedAt = deletedAt
            checkpoint.updatedAt = now
            checkpoint.needsSync = true
            count += 1
        }
        return count
    }

    // MARK: - ローカルに無い行の生成(サーバ由来なので needsSync は下ろす。
    // 親が削除済みなら子も削除済みで作る)

    static func makeTrip(_ record: TripPullRecord) -> TripEntity {
        let trip = TripEntity(
            id: record.id,
            title: record.title,
            startedAt: record.startedAt,
            endedAt: record.endedAt,
            updatedAt: record.updatedAt
        )
        trip.transport = record.transport
        trip.departureAt = record.departureAt
        trip.destination = record.destination
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
            departureTime: record.departureTime,
            updatedAt: record.updatedAt,
            trip: trip
        )
        day.deletedAt = record.deletedAt ?? trip.deletedAt
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
        checkpoint.deletedAt = record.deletedAt ?? day.deletedAt
        checkpoint.needsSync = false
        return checkpoint
    }
}
