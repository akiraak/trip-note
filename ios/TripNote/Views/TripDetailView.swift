import CoreLocation
import PhotosUI
import SwiftData
import SwiftUI

/// trip の詳細。地図と統計ヘッダ、日別プラン、メディアグリッド、位置情報のタイムラインを表示する。
struct TripDetailView: View {
    let trip: TripEntity

    @Environment(MediaImporter.self) private var importer
    @Environment(LocationRecorder.self) private var recorder
    @Environment(SyncEngine.self) private var sync
    @Environment(\.modelContext) private var modelContext
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var selectedMedia: MediaEntity?
    @State private var showsEndConfirmation = false
    @State private var showsTripEdit = false
    @State private var showsAIPlanSuggest = false

    var body: some View {
        List {
            // GPS 切断・記録停止中を線で結ばないよう、時間ギャップで区間分けして描く
            let segments = TrackSegmenter.split(
                trip.sortedPoints, recordedAt: \.recordedAt
            ).map { segment in
                segment.map {
                    CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                }
            }
            let checkpointPins = checkpointAnnotations
            if !segments.isEmpty || !checkpointPins.isEmpty {
                Section {
                    TripMapView(
                        segments: segments,
                        isActive: trip.isRecordingActive,
                        mediaAnnotations: mediaAnnotations,
                        checkpointAnnotations: checkpointPins,
                        onSelectMedia: { selectedMedia = $0 }
                    )
                    .frame(height: 300)
                    .listRowInsets(EdgeInsets())
                }
            }
            Section {
                LabeledContent("開始") {
                    if let startedAt = trip.startedAt {
                        Text(startedAt, format: .dateTime.year().month().day().hour().minute())
                    } else {
                        Text("未出発")
                            .foregroundStyle(.blue)
                    }
                }
                LabeledContent("終了") {
                    if let endedAt = trip.endedAt {
                        Text(endedAt, format: .dateTime.year().month().day().hour().minute())
                    } else if trip.status == .inProgress {
                        Text("進行中")
                            .foregroundStyle(.green)
                    } else {
                        Text("—")
                            .foregroundStyle(.secondary)
                    }
                }
                if let transport = trip.transport {
                    LabeledContent(
                        "移動手段",
                        value: Transport(rawValue: transport)?.label ?? transport
                    )
                }
                LabeledContent("地点数", value: "\(trip.points.count)")
                LabeledContent("総距離", value: ContentView.formatDistance(trip.totalDistanceMeters))
            }

            Section("プラン") {
                let days = trip.sortedDays
                ForEach(Array(days.enumerated()), id: \.element.id) { index, day in
                    NavigationLink(value: day) {
                        TripDayRow(index: index, day: day)
                    }
                }
                Button(action: addDay) {
                    Label("日を追加", systemImage: "plus")
                }
                Button {
                    showsAIPlanSuggest = true
                } label: {
                    Label("AI で行程を提案", systemImage: "sparkles")
                }
            }

            if trip.status == .inProgress {
                Section {
                    Button("旅行を終了", role: .destructive) {
                        showsEndConfirmation = true
                    }
                } footer: {
                    Text("記録の停止では旅行は終了しません。終了すると一覧で「進行中」ではなくなります。")
                }
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
        .navigationDestination(for: TripDayEntity.self) { day in
            TripDayDetailView(day: day)
        }
        .toolbar {
            // ネイティブカメラで撮った写真・動画を後から紐付ける(シミュレータの動作確認も兼ねる)
            PhotosPicker(
                selection: $pickerItems,
                matching: .any(of: [.images, .videos])
            ) {
                Label("ライブラリから追加", systemImage: "photo.badge.plus")
            }
            Button {
                showsTripEdit = true
            } label: {
                Label("旅行を編集", systemImage: "pencil")
            }
        }
        .sheet(isPresented: $showsTripEdit) {
            TripEditView(trip: trip)
        }
        .sheet(isPresented: $showsAIPlanSuggest) {
            AIPlanSuggestView(trip: trip)
        }
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            pickerItems = []
            Task { await importPicked(items) }
        }
        .fullScreenCover(item: $selectedMedia) { media in
            MediaViewerView(media: media, store: importer.store)
        }
        .confirmationDialog(
            "この旅行を終了しますか?",
            isPresented: $showsEndConfirmation,
            titleVisibility: .visible
        ) {
            Button("旅行を終了", role: .destructive) {
                recorder.endTrip(trip)
                Task { await sync.syncNow() }
            }
        } message: {
            Text("記録中の場合は記録も停止します。")
        }
    }

    private func addDay() {
        guard let day = PlanEditor.addedDay(to: trip) else { return }
        modelContext.insert(day)
        try? modelContext.save()
        Task { await sync.syncNow() }
    }

    /// 座標が決まっているチェックポイント(tombstone 除く)の地図ピン
    private var checkpointAnnotations: [TripCheckpointAnnotation] {
        trip.checkpoints.compactMap { checkpoint in
            guard
                checkpoint.deletedAt == nil,
                let latitude = checkpoint.latitude,
                let longitude = checkpoint.longitude
            else { return nil }
            return TripCheckpointAnnotation(
                checkpoint: checkpoint,
                coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            )
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

private struct TripDayRow: View {
    let index: Int
    let day: TripDayEntity

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text("\(index + 1)日目")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Text(dateText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let title = day.title, !title.isEmpty {
                Text(title)
                    .font(.subheadline)
            }
            let count = day.sortedCheckpoints.count
            Text(count > 0 ? "チェックポイント \(count) 件" : "チェックポイントなし")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var dateText: String {
        guard let date = PlanEditor.parseDate(day.date) else { return day.date }
        return date.formatted(.dateTime.month().day().weekday())
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
