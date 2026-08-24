import CoreLocation
import MapKit
import PhotosUI
import SwiftData
import SwiftUI
import UIKit

/// trip の詳細。画面いっぱいの地図の上に、行程・記録・メディア・タイムラインを
/// 載せたボトムシートを重ねる(案 C「ルートキャンバス」)
struct TripDetailView: View {
    let trip: TripEntity

    @Environment(MediaImporter.self) private var importer
    @Environment(LocationRecorder.self) private var recorder
    @Environment(SyncEngine.self) private var sync
    @Environment(\.modelContext) private var modelContext
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var selectedMedia: MediaEntity?
    @State private var showsCamera = false
    @State private var showsEndConfirmation = false
    @State private var showsDeleteConfirmation = false
    /// スワイプで削除しようとしているプラン日(確認ダイアログの対象)
    @State private var dayPendingDeletion: TripDayEntity?
    @State private var showsTripEdit = false
    @State private var showsAIPlanSuggest = false
    @State private var detent: SheetDetent = .medium
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .top) {
            mapCanvas
            // ナビゲーションバーのタイトルを地図の上でも読めるようにする
            LinearGradient(
                colors: [Theme.canvas.opacity(0.92), Theme.canvas.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 130)
            .ignoresSafeArea()
            .allowsHitTesting(false)
            RouteSheet(detent: $detent) {
                sheetBody
            }
        }
        .background(Theme.canvas)
        .navigationTitle(trip.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
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
        .fullScreenCover(isPresented: $showsCamera) {
            CameraPicker { result in
                showsCamera = false
                handleCapture(result)
            }
            .ignoresSafeArea()
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
        .confirmationDialog(
            "この旅行を削除しますか?",
            isPresented: $showsDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("旅行を削除", role: .destructive, action: deleteTrip)
        } message: {
            Text("プラン・記録・メディアごと削除され、Web にも同期されます。")
        }
        .confirmationDialog(
            "この日を削除しますか?",
            isPresented: Binding(
                get: { dayPendingDeletion != nil },
                set: { if !$0 { dayPendingDeletion = nil } }
            ),
            titleVisibility: .visible,
            presenting: dayPendingDeletion
        ) { day in
            Button("削除", role: .destructive) { deleteDay(day) }
        } message: { day in
            Text(Self.deleteDayMessage(for: day))
        }
    }

    // MARK: - 地図

    /// GPS 切断・記録停止中を線で結ばないよう、時間ギャップで区間分けして描く
    private var segments: [[CLLocationCoordinate2D]] {
        TrackSegmenter.split(trip.sortedPoints, recordedAt: \.recordedAt).map { segment in
            segment.map {
                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
            }
        }
    }

    @ViewBuilder
    private var mapCanvas: some View {
        let checkpointPins = checkpointAnnotations
        if segments.isEmpty && checkpointPins.isEmpty {
            // 軌跡もチェックポイントも無いうちは、地図の代わりに理由を出す
            Theme.canvas
                .overlay {
                    VStack(spacing: 8) {
                        Image(systemName: "map")
                            .font(.system(size: 28))
                        Text("地図に出す地点がありません")
                            .font(.subheadline)
                    }
                    .foregroundStyle(Theme.line)
                }
                .ignoresSafeArea()
        } else {
            TripMapView(
                segments: segments,
                isActive: trip.isRecordingActive,
                mediaAnnotations: mediaAnnotations,
                checkpointAnnotations: checkpointPins,
                compactCheckpoints: true,
                planRoute: checkpointPins.map(\.coordinate),
                // シートで隠れる下側を避けて、ルート全体が見えるようにする
                bottomCoverRatio: detent.coverRatio,
                onSelectMedia: { selectedMedia = $0 }
            )
            .ignoresSafeArea()
        }
    }

    // MARK: - シート

    private var sheetBody: some View {
        SheetList {
            summaryRow
            statsRow
            planSection
            if trip.endedAt == nil {
                sectionLabel("RECORD")
                recordingSection
            }
            if trip.status == .inProgress {
                endTripRow
            }
            mediaSection
            timelineSection
            deleteTripRow
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        PanelLabel(text: text)
            .padding(.top, 14)
            .padding(.bottom, 2)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
    }

    /// シートの一番上。旅行の状態と日数をひと目で
    private var summaryRow: some View {
        HStack(spacing: 8) {
            Text("行程")
                .font(.headline)
                .foregroundStyle(Theme.ink)
            statusTag
            Spacer(minLength: 4)
            if !trip.sortedDays.isEmpty {
                Text("\(trip.sortedDays.count) 日間")
                    .font(Theme.numeric(.caption))
                    .foregroundStyle(Theme.muted)
            }
        }
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 6, trailing: 16))
    }

    @ViewBuilder
    private var statusTag: some View {
        if trip.isRecordingActive {
            StatusTag(label: "記録中", color: Theme.done)
        } else if trip.status == .inProgress {
            StatusTag(label: "進行中", color: Theme.done)
        } else if trip.status == .planning {
            StatusTag(label: "プラン中", color: Theme.accent)
        }
    }

    private var statsRow: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), alignment: .leading),
                      GridItem(.flexible(), alignment: .leading)],
            spacing: 12
        ) {
            StatCell(
                label: "開始",
                value: trip.startedAt.map {
                    $0.formatted(.dateTime.year().month().day().hour().minute())
                } ?? "未出発",
                valueColor: trip.startedAt == nil ? Theme.accent : Theme.ink
            )
            StatCell(
                label: "終了",
                value: endedText,
                valueColor: trip.endedAt == nil && trip.status == .inProgress
                    ? Theme.done : Theme.ink
            )
            StatCell(
                label: "出発予定",
                value: trip.departureAt.map {
                    $0.formatted(.dateTime.year().month().day().hour().minute())
                } ?? "—"
            )
            StatCell(label: "目的地", value: trip.destination ?? "—", isNumeric: false)
            StatCell(label: "地点数", value: "\(trip.points.count)")
            StatCell(label: "総距離", value: ContentView.formatDistance(trip.totalDistanceMeters))
        }
        .padding(.vertical, 6)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
    }

    private var endedText: String {
        if let endedAt = trip.endedAt {
            return endedAt.formatted(.dateTime.year().month().day().hour().minute())
        }
        return trip.status == .inProgress ? "進行中" : "—"
    }

    @ViewBuilder
    private var planSection: some View {
        sectionLabel("PLAN")
        let days = trip.sortedDays
        if days.isEmpty {
            Text("プランはまだありません")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        }
        ForEach(Array(days.enumerated()), id: \.element.id) { index, day in
            NavigationLink(value: day) {
                TripDayRow(
                    index: index,
                    day: day,
                    routeStart: Self.routeAnchor(before: index, in: days)
                )
            }
            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            // 途中への差し込み・途中の削除(どちらも以降の日の日付がずれる)
            .swipeActions(edge: .leading) {
                Button {
                    insertDay(after: day)
                } label: {
                    Label("次の日を追加", systemImage: "calendar.badge.plus")
                }
                .tint(Theme.accent)
            }
            .swipeActions(edge: .trailing) {
                Button(role: .destructive) {
                    dayPendingDeletion = day
                } label: {
                    Label("削除", systemImage: "trash")
                }
            }
        }
        HStack(spacing: 18) {
            Button(action: addDay) {
                Label("日を追加", systemImage: "plus")
            }
            Button {
                showsAIPlanSuggest = true
            } label: {
                Label("AI で行程を提案", systemImage: "sparkles")
            }
            Spacer(minLength: 0)
        }
        .font(.subheadline)
        .buttonStyle(.plain)
        .foregroundStyle(Theme.accent)
        .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 10, trailing: 16))
    }

    /// この旅行への記録の開始/停止と記録中の撮影(記録はこの旅行に対して行う)
    @ViewBuilder
    private var recordingSection: some View {
        if trip.isRecordingActive {
            VStack(alignment: .leading, spacing: 6) {
                Label("記録中", systemImage: "location.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.done)
                HStack(spacing: 14) {
                    Text("\(recorder.recordedPointCount) 地点")
                    Text(ContentView.formatDistance(recorder.totalDistanceMeters))
                }
                .font(Theme.numeric(.caption))
                .foregroundStyle(Theme.muted)
                Text("画面を閉じても記録は続きます")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
            if CameraPicker.isAvailable {
                Button {
                    showsCamera = true
                } label: {
                    Label("写真・動画を撮影", systemImage: "camera")
                }
                .font(.subheadline)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.accent)
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
            }
            VStack(alignment: .leading, spacing: 4) {
                Button("記録を停止") {
                    recorder.stopRecording()
                    Task { await sync.syncNow() }
                }
                .font(.subheadline)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.danger)
                Text("停止しても旅行は終了しません。")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        } else if recorder.isRecording {
            Text("別の旅行を記録中です")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        } else {
            Button {
                recorder.startRecording(trip: trip)
            } label: {
                Label("記録を開始", systemImage: "record.circle")
            }
            .font(.subheadline)
            .buttonStyle(.plain)
            .foregroundStyle(Theme.accent)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        }

        if let error = recorder.lastError {
            Text(error)
                .font(.caption)
                .foregroundStyle(Theme.danger)
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
        }

        if recorder.authorizationStatus == .denied || recorder.authorizationStatus == .restricted {
            Link(
                "設定アプリで位置情報を許可する",
                destination: URL(string: UIApplication.openSettingsURLString)!
            )
            .font(.caption)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
        }
    }

    private var endTripRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button("旅行を終了") {
                showsEndConfirmation = true
            }
            .font(.subheadline)
            .buttonStyle(.plain)
            .foregroundStyle(Theme.danger)
            Text("記録の停止では旅行は終了しません。終了すると一覧で「進行中」ではなくなります。")
                .font(.caption)
                .foregroundStyle(Theme.muted)
        }
        .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 10, trailing: 16))
    }

    @ViewBuilder
    private var mediaSection: some View {
        sectionLabel("MEDIA")
        let media = trip.sortedMedia
        if media.isEmpty {
            Text("写真・動画がありません")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 4)], spacing: 4) {
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
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        }
        if importer.isImporting {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("取り込み中…")
                    .foregroundStyle(Theme.muted)
            }
            .font(.subheadline)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
        }
        if let error = importer.lastError {
            Text(error)
                .font(.caption)
                .foregroundStyle(Theme.danger)
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
        }
    }

    @ViewBuilder
    private var timelineSection: some View {
        sectionLabel("TIMELINE")
        let points = trip.sortedPoints
        if points.isEmpty {
            Text("位置情報がありません")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        }
        ForEach(points) { point in
            PointRow(point: point)
                .listRowInsets(EdgeInsets(top: 7, leading: 16, bottom: 7, trailing: 16))
        }
    }

    private var deleteTripRow: some View {
        Button("旅行を削除") {
            showsDeleteConfirmation = true
        }
        .font(.subheadline)
        .buttonStyle(.plain)
        .foregroundStyle(Theme.danger)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 22, leading: 16, bottom: 16, trailing: 16))
    }

    // MARK: - 操作

    /// 日の削除確認の文言。最終日以外は後続の日付がずれることを明示する
    static func deleteDayMessage(for day: TripDayEntity) -> String {
        let isLast = day.trip?.sortedDays.last?.id == day.id
        let base = "この日のチェックポイントも削除されます。"
        return isLast ? base : base + "以降の日は 1 日前にずれます。"
    }

    private func handleCapture(_ result: CameraPicker.CaptureResult?) {
        guard let result else { return }
        Task {
            switch result {
            case .photo(let image):
                await importer.importPhoto(image, into: trip, takenAt: Date())
            case .video(let url):
                await importer.importVideo(at: url, into: trip, takenAt: Date())
            }
        }
    }

    /// 旅行を削除(tombstone)する。この旅行を記録中なら記録を止めてから削除する
    private func deleteTrip() {
        if trip.persistentModelID == recorder.activeTrip?.persistentModelID {
            recorder.stopRecording()
        }
        PlanEditor.delete(trip)
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
    }

    private func addDay() {
        guard let day = PlanEditor.addedDay(to: trip) else { return }
        modelContext.insert(day)
        try? modelContext.save()
        Task { await sync.syncNow() }
    }

    /// この日の翌日に空の日を差し込む(以降の日は 1 日ずつ後ろへずれる)
    private func insertDay(after day: TripDayEntity) {
        guard let inserted = PlanEditor.insertedDay(after: day) else { return }
        modelContext.insert(inserted)
        try? modelContext.save()
        Task { await sync.syncNow() }
    }

    /// この日を削除する(以降の日は 1 日前へ詰める)
    private func deleteDay(_ day: TripDayEntity) {
        PlanEditor.deleteShiftingFollowing(day)
        dayPendingDeletion = nil
        try? modelContext.save()
        Task { await sync.syncNow() }
    }

    /// トップ地図のピン: 今日以降の日(当日含む)のチェックポイント(座標あり)。
    /// すべて過去日なら全日にフォールバックする(軌跡・メディアは絞らない)
    private var checkpointAnnotations: [TripCheckpointAnnotation] {
        PlanEditor.upcomingDays(of: trip).flatMap { day in
            day.sortedCheckpoints.compactMap(TripCheckpointAnnotation.make)
        }
    }

    /// index 日目のルートの起点 = それより前の日の最後の座標ありチェックポイント(前泊地など)
    static func routeAnchor(
        before index: Int,
        in days: [TripDayEntity]
    ) -> CLLocationCoordinate2D? {
        guard
            let anchor = DayRoute.anchor(before: index, in: days),
            let latitude = anchor.latitude, let longitude = anchor.longitude
        else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
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

/// シートの中のプラン 1 日。地図は画面いっぱいの方に出ているので、
/// ここは日付・出発時刻・走行距離・行程・経由地だけを読む行にする
private struct TripDayRow: View {
    let index: Int
    let day: TripDayEntity
    /// 前日までの最後の座標(前泊地など)。走行距離の起点になる
    var routeStart: CLLocationCoordinate2D?

    /// レグの解決結果。距離表示に使う(道路形状は画面いっぱいの地図が描く)
    @State private var resolvedLegs: [String: ResolvedRouteLeg] = [:]

    private var annotations: [TripCheckpointAnnotation] {
        day.sortedCheckpoints.compactMap(TripCheckpointAnnotation.make)
    }

    private var legs: [RouteLeg] {
        RouteLegBuilder.legs(
            routeStart: routeStart?.routePoint,
            through: annotations.map(\.coordinate.routePoint)
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(index + 1)日目")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.ink)
                Text(PlanEditor.displayDate(day.date))
                    .font(Theme.numeric(.caption))
                    .foregroundStyle(Theme.muted)
                Spacer(minLength: 4)
                if let departureTime = day.departureTime {
                    metric(departureTime, systemImage: "clock")
                }
                // 車での走行距離。未解決レグ混じり・OSRM 由来のどちらでも概算なので常に「約」
                if !legs.isEmpty {
                    metric(
                        "約\(ContentView.formatDistance(RouteLegDistance.totalMeters(legs: legs, resolved: resolvedLegs)))",
                        systemImage: "car"
                    )
                }
            }
            if let title = day.title, !title.isEmpty {
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink)
            }
            // チェックポイントの概要(訪問順に名前を繋ぐ)
            let checkpoints = day.sortedCheckpoints
            if checkpoints.isEmpty {
                Text("チェックポイントなし")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            } else {
                Text(checkpoints.map(\.name).joined(separator: " → "))
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 9)
        // チェックポイントの追加・並び替え・座標の具体化でレグキー列が変わったら解決し直す
        // (キャッシュ済みレグは即答し、変わった区間だけサーバへ問い合わせる)
        .task(id: legs.map(\.key).joined(separator: "|")) {
            guard !legs.isEmpty, let client = SyncClient.fromBundle() else { return }
            resolvedLegs = await client.resolvedLegs(for: legs)
        }
    }

    private func metric(_ text: String, systemImage: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: systemImage)
                .font(.system(size: 10))
            Text(text)
                .font(Theme.numeric(.caption))
        }
        .foregroundStyle(Theme.muted)
    }
}

private struct PointRow: View {
    let point: LocationPointEntity

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(point.recordedAt, format: .dateTime.month().day().hour().minute().second())
                .font(Theme.numeric(.subheadline))
                .foregroundStyle(Theme.ink)
            HStack(spacing: 10) {
                Text(String(format: "%.5f, %.5f", point.latitude, point.longitude))
                if let altitude = point.altitude {
                    Text(String(format: "高度 %.0f m", altitude))
                }
                if let accuracy = point.horizontalAccuracy {
                    Text(String(format: "±%.0f m", accuracy))
                }
            }
            .font(Theme.numeric(.caption))
            .foregroundStyle(Theme.muted)
        }
    }
}
