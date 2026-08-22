import MapKit
import SwiftUI

/// 地図上に出すメディアのサムネイルマーカー
struct TripMediaAnnotation: Identifiable {
    let media: MediaEntity
    let coordinate: CLLocationCoordinate2D

    var id: UUID { media.id }
}

/// trip の軌跡をポリラインで表示する地図。
/// 個々の位置情報のドットは描画しない(数千点になり得るため)。
/// 位置に紐付いたメディアはサムネイルの Annotation で表示する。
struct TripMapView: View {
    let coordinates: [CLLocationCoordinate2D]
    /// 記録中は最新地点のマーカーを「現在」として表示する
    let isActive: Bool
    var mediaAnnotations: [TripMediaAnnotation] = []
    var onSelectMedia: ((MediaEntity) -> Void)?

    private let store = MediaStore.makeDefault()

    var body: some View {
        Map(initialPosition: .automatic) {
            if coordinates.count >= 2 {
                MapPolyline(coordinates: coordinates)
                    .stroke(
                        .blue,
                        style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
                    )
            }
            if let first = coordinates.first {
                Marker("開始", systemImage: "flag.fill", coordinate: first)
                    .tint(.green)
            }
            if coordinates.count >= 2, let last = coordinates.last {
                Marker(isActive ? "現在" : "終了", systemImage: "flag.checkered", coordinate: last)
                    .tint(.red)
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
