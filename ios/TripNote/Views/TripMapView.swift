import MapKit
import SwiftUI

extension RoutePoint {
    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension CLLocationCoordinate2D {
    var routePoint: RoutePoint {
        RoutePoint(latitude: latitude, longitude: longitude)
    }
}

/// 地図上に出すメディアのサムネイルマーカー
struct TripMediaAnnotation: Identifiable {
    let media: MediaEntity
    let coordinate: CLLocationCoordinate2D

    var id: UUID { media.id }
}

/// 地図上に出すプランのチェックポイントピン
struct TripCheckpointAnnotation: Identifiable {
    let checkpoint: CheckpointEntity
    let coordinate: CLLocationCoordinate2D

    var id: UUID { checkpoint.id }

    /// 座標が決まっているチェックポイントだけピンにする
    static func make(_ checkpoint: CheckpointEntity) -> TripCheckpointAnnotation? {
        guard
            let latitude = checkpoint.latitude,
            let longitude = checkpoint.longitude
        else { return nil }
        return TripCheckpointAnnotation(
            checkpoint: checkpoint,
            coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        )
    }
}

/// trip の軌跡をポリラインで表示する地図。
/// GPS 切断・記録停止中を線で結ばないよう、時間ギャップで分割済みの区間ごとに描く。
/// 個々の位置情報のドットは描画しない(数千点になり得るため)。
/// 位置に紐付いたメディアはサムネイルの Annotation で、
/// プランのチェックポイントは種別ごとのアイコン・色の Marker で表示する。
struct TripMapView: View {
    /// TrackSegmenter.split で区間分割済みの座標列
    let segments: [[CLLocationCoordinate2D]]
    /// 記録中は最新地点のマーカーを「現在」として表示する
    let isActive: Bool
    var mediaAnnotations: [TripMediaAnnotation] = []
    var checkpointAnnotations: [TripCheckpointAnnotation] = []
    /// 今後のプランのルート(チェックポイントを日順・訪問順につないだ座標列)。
    /// 記録済みの軌跡(実線)と区別するため破線で描く。レグ(隣接点間)ごとに
    /// 道路形状を非同期で解決し、未取得・失敗レグは従来どおりの直線で描く
    var planRoute: [CLLocationCoordinate2D] = []
    var onSelectMedia: ((MediaEntity) -> Void)?

    private let store = MediaStore.makeDefault()

    @State private var roadLegs: [String: ResolvedRouteLeg] = [:]

    private var planLegs: [RouteLeg] {
        RouteLegBuilder.legs(through: planRoute.map(\.routePoint))
    }

    private var totalCount: Int {
        segments.reduce(0) { $0 + $1.count }
    }

    var body: some View {
        Map(initialPosition: .automatic) {
            ForEach(Array(planLegs.enumerated()), id: \.offset) { _, leg in
                MapPolyline(coordinates: polyline(for: leg))
                    .stroke(
                        .blue.opacity(0.55),
                        style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [6, 6])
                    )
            }
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                if segment.count >= 2 {
                    MapPolyline(coordinates: segment)
                        .stroke(
                            .blue,
                            style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
                        )
                }
            }
            if let first = segments.first?.first {
                Marker("開始", systemImage: "flag.fill", coordinate: first)
                    .tint(.green)
            }
            if totalCount >= 2, let last = segments.last?.last {
                Marker(isActive ? "現在" : "終了", systemImage: "flag.checkered", coordinate: last)
                    .tint(.red)
            }
            ForEach(checkpointAnnotations) { annotation in
                Marker(
                    annotation.checkpoint.name,
                    systemImage: annotation.checkpoint.type.systemImage,
                    coordinate: annotation.coordinate
                )
                .tint(annotation.checkpoint.type.tint)
            }
            ForEach(mediaAnnotations) { annotation in
                Annotation("", coordinate: annotation.coordinate) {
                    annotationThumbnail(annotation.media)
                        .onTapGesture {
                            onSelectMedia?(annotation.media)
                        }
                }
            }
        }
        .mapStyle(.standard)
        .task(id: planLegs.map(\.key).joined(separator: "|")) {
            guard !planLegs.isEmpty, let client = SyncClient.fromBundle() else { return }
            roadLegs = await client.resolvedLegs(for: planLegs)
        }
    }

    private func polyline(for leg: RouteLeg) -> [CLLocationCoordinate2D] {
        roadLegs[leg.key]?.points.map(\.clCoordinate)
            ?? [leg.from.clCoordinate, leg.to.clCoordinate]
    }

    @ViewBuilder
    private func annotationThumbnail(_ media: MediaEntity) -> some View {
        let path = store.url(for: media.thumbnailFileName).path(percentEncoded: false)
        Group {
            if let image = UIImage(contentsOfFile: path) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: media.type == .video ? "video.fill" : "photo.fill")
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.gray)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay {
            RoundedRectangle(cornerRadius: 6)
                .stroke(.white, lineWidth: 2)
        }
        .shadow(radius: 2)
        .overlay {
            if media.type == .video {
                Image(systemName: "play.fill")
                    .font(.caption)
                    .foregroundStyle(.white)
                    .shadow(radius: 2)
            }
        }
    }
}
