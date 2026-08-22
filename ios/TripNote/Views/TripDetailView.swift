import CoreLocation
import PhotosUI
import SwiftUI

/// trip の詳細。地図と統計ヘッダ、メディアグリッド、位置情報のタイムラインを表示する。
struct TripDetailView: View {
    let trip: TripEntity

    @Environment(MediaImporter.self) private var importer
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var selectedMedia: MediaEntity?

    var body: some View {
        List {
            let coordinates = trip.sortedPoints.map {
                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
            }
            if !coordinates.isEmpty {
                Section {
                    TripMapView(
                        coordinates: coordinates,
                        isActive: trip.isActive,
                        mediaAnnotations: mediaAnnotations,
                        onSelectMedia: { selectedMedia = $0 }
                    )
                    .frame(height: 300)
                    .listRowInsets(EdgeInsets())
                }
            }
            Section {
                LabeledContent("開始") {
                    Text(trip.startedAt, format: .dateTime.year().month().day().hour().minute())
                }
                LabeledContent("終了") {
                    if let endedAt = trip.endedAt {
                        Text(endedAt, format: .dateTime.year().month().day().hour().minute())
                    } else {
                        Text("記録中")
                            .foregroundStyle(.green)
                    }
                }
                LabeledContent("地点数", value: "\(trip.points.count)")
                LabeledContent("総距離", value: ContentView.formatDistance(trip.totalDistanceMeters))
            }

            Section("メディア") {
                mediaSection
            }

            Section("タイムライン") {
                let points = trip.sortedPoints
                if points.isEmpty {
                    Text("位置情報がありません")
                        .foregroundStyle(.secondary)
                }
                ForEach(points) { point in
                    PointRow(point: point)
                }
            }
        }
        .navigationTitle(trip.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // ネイティブカメラで撮った写真・動画を後から紐付ける(シミュレータの動作確認も兼ねる)
            PhotosPicker(
                selection: $pickerItems,
                matching: .any(of: [.images, .videos])
            ) {
                Label("ライブラリから追加", systemImage: "photo.badge.plus")
            }
        }
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            pickerItems = []
            Task { await importPicked(items) }
        }
        .fullScreenCover(item: $selectedMedia) { media in
            MediaViewerView(media: media, store: importer.store)
        }
    }

    private var mediaAnnotations: [TripMediaAnnotation] {
        trip.sortedMedia.compactMap { media in
            guard let point = media.locationPoint else { return nil }
            return TripMediaAnnotation(
                media: media,
                coordinate: CLLocationCoordinate2D(
                    latitude: point.latitude,
                    longitude: point.longitude
                )
            )
        }
    }

    @ViewBuilder
    private var mediaSection: some View {
        let media = trip.sortedMedia
        if media.isEmpty {
            Text("写真・動画がありません")
                .foregroundStyle(.secondary)
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 4)], spacing: 4) {
                ForEach(media) { item in
                    Button {
                        selectedMedia = item
                    } label: {
                        MediaThumbnail(media: item, store: importer.store)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("media-thumbnail")
                }
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
        }
        if importer.isImporting {
            HStack(spacing: 8) {
                ProgressView()
                Text("取り込み中…")
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline)
        }
        if let error = importer.lastError {
            Text(error)
                .font(.caption)
                .foregroundStyle(.red)
        }
    }

    private func importPicked(_ items: [PhotosPickerItem]) async {
        for item in items {
            let isVideo = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
            if isVideo {
                if let picked = try? await item.loadTransferable(type: PickedVideo.self) {
                    await importer.importVideo(at: picked.url, into: trip, takenAt: nil)
                }
            } else if let data = try? await item.loadTransferable(type: Data.self) {
                await importer.importPhoto(data: data, into: trip)
            }
        }
    }
}

private struct PointRow: View {
    let point: LocationPointEntity

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(point.recordedAt, format: .dateTime.month().day().hour().minute().second())
                .font(.subheadline)
            HStack(spacing: 12) {
                Text(String(format: "%.5f, %.5f", point.latitude, point.longitude))
                if let altitude = point.altitude {
                    Text(String(format: "高度 %.0f m", altitude))
                }
                if let accuracy = point.horizontalAccuracy {
                    Text(String(format: "±%.0f m", accuracy))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 1)
    }
}
