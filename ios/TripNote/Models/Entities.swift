import Foundation
import SwiftData

@Model
final class TripEntity {
    @Attribute(.unique) var id: UUID
    var title: String
    /// nil はプラン段階(未出発)。記録開始時に設定される
    var startedAt: Date?
    /// 「旅行を終了」の明示操作で設定する(記録停止 ≠ 旅行終了)
    var endedAt: Date?
    /// 移動手段(car / train / walk / bicycle / mixed など)。AI 行程提案の入力に使う
    var transport: String?
    /// 出発予定日時。実績の startedAt とは別で、プラン 1 日目の日付の基準になる
    var departureAt: Date?
    /// 目的地(自由記述)。AI の日数・宿泊地候補出しの入力に使う
    var destination: String?
    /// tombstone。削除は物理削除せず deleted_at を同期で伝搬する
    var deletedAt: Date?
    /// 編集時刻。双方向同期の LWW の基準になるため、同期対象フィールドの変更時は必ず更新する
    /// (isRecordingActive / needsSync などローカル専用フィールドの変更では更新しない)
    var updatedAt: Date = Date()
    /// この旅行を現在記録中か(ローカル専用・同期しない)。
    /// アプリがシステムに終了された後の記録再開(resumeIfNeeded)の目印になる
    var isRecordingActive: Bool = false
    /// サーバへ未同期の変更があるか
    var needsSync: Bool = true

    @Relationship(deleteRule: .cascade, inverse: \LocationPointEntity.trip)
    var points: [LocationPointEntity] = []

    @Relationship(deleteRule: .cascade, inverse: \MediaEntity.trip)
    var media: [MediaEntity] = []

    @Relationship(deleteRule: .cascade, inverse: \TripDayEntity.trip)
    var days: [TripDayEntity] = []

    @Relationship(deleteRule: .cascade, inverse: \CheckpointEntity.trip)
    var checkpoints: [CheckpointEntity] = []

    init(
        id: UUID = UUID(),
        title: String,
        startedAt: Date? = nil,
        endedAt: Date? = nil,
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.updatedAt = updatedAt
    }

    var status: TripStatus {
        if startedAt == nil { return .planning }
        return endedAt == nil ? .inProgress : .finished
    }

    var sortedPoints: [LocationPointEntity] {
        points.sorted { $0.recordedAt < $1.recordedAt }
    }

    /// 削除済み(tombstone)を除いた、撮影・追加時刻の新しい順のメディア
    /// (同時刻は id で決めて並びが実行ごとに揺れないようにする)
    var sortedMedia: [MediaEntity] {
        media.filter { $0.deletedAt == nil }.sorted {
            $0.takenAt == $1.takenAt
                ? $0.id.uuidString > $1.id.uuidString
                : $0.takenAt > $1.takenAt
        }
    }

    /// 削除済み(tombstone)を除いた日付順のプラン日
    var sortedDays: [TripDayEntity] {
        days.filter { $0.deletedAt == nil }.sorted { $0.date < $1.date }
    }

    var totalDistanceMeters: Double {
        Geo.totalDistance(coordinates: sortedPoints.map { ($0.latitude, $0.longitude) })
    }
}

/// プランの 1 日。チェックポイントはこの日に紐付く
@Model
final class TripDayEntity {
    @Attribute(.unique) var id: UUID
    /// YYYY-MM-DD(タイムゾーンの揺れを避けるため文字列で保持。サーバと同形式)
    var date: String
    /// 大まかな行程(例: 松本周辺を観光して泊)
    var title: String?
    var note: String?
    /// 前泊地を出発する時刻 "HH:MM"(date と同じタイムゾーン素朴表現)。
    /// 以降のチェックポイントの到着予想の起点(予想は保存せず表示時に導出する)
    var departureTime: String?
    /// 編集時刻。双方向同期の LWW の基準になるため、変更時は必ず更新する
    var updatedAt: Date
    /// tombstone。削除は物理削除せず deleted_at を同期で伝搬する
    var deletedAt: Date?
    /// サーバへ未同期の変更があるか
    var needsSync: Bool = true
    var trip: TripEntity?

    @Relationship(deleteRule: .cascade, inverse: \CheckpointEntity.tripDay)
    var checkpoints: [CheckpointEntity] = []

    init(
        id: UUID = UUID(),
        date: String,
        title: String? = nil,
        note: String? = nil,
        departureTime: String? = nil,
        updatedAt: Date = Date(),
        trip: TripEntity? = nil
    ) {
        self.id = id
        self.date = date
        self.title = title
        self.note = note
        self.departureTime = departureTime
        self.updatedAt = updatedAt
        self.trip = trip
    }

    /// 削除済み(tombstone)を除いた表示順のチェックポイント
    var sortedCheckpoints: [CheckpointEntity] {
        checkpoints.filter { $0.deletedAt == nil }.sorted {
            ($0.sortOrder, $0.name) < ($1.sortOrder, $1.name)
        }
    }
}

/// プランのチェックポイント(出発地・観光地・宿など)
@Model
final class CheckpointEntity {
    @Attribute(.unique) var id: UUID
    /// CheckpointType.rawValue。SwiftData には文字列で保存する
    var typeRawValue: String
    var name: String
    /// 地域だけ決まっていて座標未定なら nil
    var latitude: Double?
    var longitude: Double?
    /// 立ち寄り予定時刻(任意)
    var plannedTime: Date?
    var note: String?
    /// 日の中での表示順
    var sortOrder: Int
    /// 編集時刻。双方向同期の LWW の基準になるため、変更時は必ず更新する
    var updatedAt: Date
    /// tombstone。削除は物理削除せず deleted_at を同期で伝搬する
    var deletedAt: Date?
    /// サーバへ未同期の変更があるか
    var needsSync: Bool = true
    var trip: TripEntity?
    var tripDay: TripDayEntity?

    init(
        id: UUID = UUID(),
        type: CheckpointType,
        name: String,
        latitude: Double? = nil,
        longitude: Double? = nil,
        plannedTime: Date? = nil,
        note: String? = nil,
        sortOrder: Int = 0,
        updatedAt: Date = Date(),
        trip: TripEntity? = nil,
        tripDay: TripDayEntity? = nil
    ) {
        self.id = id
        self.typeRawValue = type.rawValue
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.plannedTime = plannedTime
        self.note = note
        self.sortOrder = sortOrder
        self.updatedAt = updatedAt
        self.trip = trip
        self.tripDay = tripDay
    }

    var type: CheckpointType { CheckpointType(rawValue: typeRawValue) ?? .other }
}

@Model
final class LocationPointEntity {
    @Attribute(.unique) var id: UUID
    var latitude: Double
    var longitude: Double
    var altitude: Double?
    var horizontalAccuracy: Double?
    var recordedAt: Date
    var trip: TripEntity?
    /// Supabase へ未同期か(位置情報は不変なのでアップロード成功で false になったら変わらない)
    var needsSync: Bool = true

    @Relationship(deleteRule: .nullify, inverse: \MediaEntity.locationPoint)
    var media: [MediaEntity] = []

    init(
        id: UUID = UUID(),
        latitude: Double,
        longitude: Double,
        altitude: Double? = nil,
        horizontalAccuracy: Double? = nil,
        recordedAt: Date,
        trip: TripEntity? = nil
    ) {
        self.id = id
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.horizontalAccuracy = horizontalAccuracy
        self.recordedAt = recordedAt
        self.trip = trip
    }
}

@Model
final class MediaEntity {
    @Attribute(.unique) var id: UUID
    /// MediaType.rawValue("photo" | "video")。SwiftData には文字列で保存する
    var typeRawValue: String
    /// MediaStore 内のファイル名(`<id>.jpg` / `<id>.mp4` / `<id>.mov`)
    var fileName: String
    /// グリッド・地図マーカー用サムネイル(`<id>-thumb.jpg`)
    var thumbnailFileName: String
    var takenAt: Date
    var trip: TripEntity?
    /// 撮影時刻に最も近い記録点(MediaAttachment)。点が無い trip では nil
    var locationPoint: LocationPointEntity?
    /// メディア自身の撮影位置(写真の EXIF GPS / 動画メタデータ。MediaCoordinate)。
    /// 位置情報を持たないメディアでは nil
    var latitude: Double?
    var longitude: Double?
    /// 削除済みの目印。ローカルのファイルは削除時にすぐ消し、この行は
    /// サーバへ DELETE を送るまで残す(送信できたら行も物理削除する)
    var deletedAt: Date?
    /// サーバへ未同期か(メディアは不変なのでアップロード成功で false のまま。
    /// 削除時は DELETE を送るために true へ戻す)
    var needsSync: Bool = true

    init(
        id: UUID = UUID(),
        type: MediaType,
        fileName: String,
        thumbnailFileName: String,
        takenAt: Date,
        trip: TripEntity? = nil,
        locationPoint: LocationPointEntity? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil
    ) {
        self.id = id
        self.typeRawValue = type.rawValue
        self.fileName = fileName
        self.thumbnailFileName = thumbnailFileName
        self.takenAt = takenAt
        self.trip = trip
        self.locationPoint = locationPoint
        self.latitude = latitude
        self.longitude = longitude
    }

    var type: MediaType { MediaType(rawValue: typeRawValue) ?? .photo }

    /// 地図に出す座標。メディア自身の撮影位置を優先し、無ければ紐付いた記録点。
    /// どちらも無ければ nil(地図には出さずグリッドにだけ出る)
    var displayCoordinate: MediaCoordinate.Coordinate? {
        if let latitude, let longitude {
            return MediaCoordinate.Coordinate(latitude: latitude, longitude: longitude)
        }
        guard let locationPoint else { return nil }
        return MediaCoordinate.Coordinate(
            latitude: locationPoint.latitude,
            longitude: locationPoint.longitude
        )
    }
}
