import Foundation
import SwiftData

/// 記録点をバックグラウンドで読み出して TrackSnapshot に固めるローダ。
/// main の ModelContext は使わない(数万点のフォールトと並べ替えで UI が止まるため)。
/// ソートは FetchDescriptor(SQL)に任せ、エンティティは値型に写してから集計する
enum TrackLoader {
    /// 旅行画面の地図に描く座標数の上限
    static let detailDisplayLimit = 2_000
    /// 一覧のサムネイル(RouteThumbnail)に描く座標数の上限
    static let thumbnailDisplayLimit = 80

    static func load(
        tripId: UUID,
        container: ModelContainer,
        displayLimit: Int
    ) async -> TrackSnapshot {
        let task = Task.detached(priority: .userInitiated) { () -> TrackSnapshot in
            let context = ModelContext(container)
            let descriptor = FetchDescriptor<LocationPointEntity>(
                predicate: #Predicate { $0.trip?.id == tripId },
                sortBy: [SortDescriptor(\.recordedAt)]
            )
            let points = (try? context.fetch(descriptor)) ?? []
            return TrackSnapshot.make(
                points: points.map {
                    TrackSnapshot.Point(
                        latitude: $0.latitude,
                        longitude: $0.longitude,
                        recordedAt: $0.recordedAt
                    )
                },
                displayLimit: displayLimit
            )
        }
        return await task.value
    }
}
