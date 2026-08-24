import CoreLocation
import SwiftData
import SwiftUI

/// プランの 1 日の詳細。画面いっぱいのその日の地図の上に、
/// 行程・チェックポイントのシートを重ねる(案 C「ルートキャンバス」)
struct TripDayDetailView: View {
    let day: TripDayEntity

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(SyncEngine.self) private var sync

    @State private var showsDayEdit = false
    @State private var showsLinkAdd = false
    @State private var showsManualAdd = false
    @State private var editingCheckpoint: CheckpointEntity?
    @State private var showsDeleteConfirmation = false
    @State private var detent: SheetDetent = .medium
    /// 到着予想用のレグ解決結果。地図(TripMapView)側と同じレグキーなので
    /// メモリ/サーバのキャッシュが効き、二重リクエストにならない
    @State private var resolvedLegs: [String: ResolvedRouteLeg] = [:]

    var body: some View {
        ZStack(alignment: .top) {
            mapCanvas
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
        .navigationTitle(dayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            // チェックポイントの並べ替え用
            EditButton()
        }
        // CP の追加・並び替え・座標の具体化でレグキー列が変わったら所要時間を解決し直す
        // (キャッシュ済みレグは即答。出発時刻・plannedTime の変更は @Model の監視で再計算される)
        .task(id: dayLegs.map(\.key).joined(separator: "|")) {
            guard !dayLegs.isEmpty, let client = SyncClient.fromBundle() else { return }
            resolvedLegs = await client.resolvedLegs(for: dayLegs)
        }
        .sheet(isPresented: $showsDayEdit) {
            TripDayEditView(day: day)
        }
        .sheet(isPresented: $showsLinkAdd) {
            GoogleMapsLinkView(allowsMissingCoordinate: true) { place in
                addCheckpoint(from: place)
            }
        }
        .sheet(isPresented: $showsManualAdd) {
            CheckpointEditView(day: day)
        }
        .sheet(item: $editingCheckpoint) { checkpoint in
            CheckpointEditView(day: day, checkpoint: checkpoint)
        }
        .confirmationDialog(
            "この日を削除しますか?",
            isPresented: $showsDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("削除", role: .destructive) {
                PlanEditor.deleteShiftingFollowing(day)
                try? modelContext.save()
                dismiss()
                Task { await sync.syncNow() }
            }
        } message: {
            Text(TripDetailView.deleteDayMessage(for: day))
        }
    }

    // MARK: - 地図

    @ViewBuilder
    private var mapCanvas: some View {
        let pins = checkpointAnnotations
        if pins.isEmpty {
            Theme.canvas
                .overlay {
                    VStack(spacing: 8) {
                        Image(systemName: "mappin.slash")
                            .font(.system(size: 28))
                        Text("座標のあるチェックポイントがありません")
                            .font(.subheadline)
                    }
                    .foregroundStyle(Theme.line)
                }
                .ignoresSafeArea()
        } else {
            TripMapView(
                segments: [],
                isActive: false,
                checkpointAnnotations: pins,
                planRoute: dayRoute
            )
            .ignoresSafeArea()
        }
    }

    // MARK: - シート

    private var sheetBody: some View {
        SheetList {
            summaryRow
            statsRow
            if let note = day.note, !note.isEmpty {
                Text(note)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 10, trailing: 16))
            }
            Button {
                showsDayEdit = true
            } label: {
                Label("行程・メモを編集", systemImage: "pencil")
            }
            .font(.subheadline)
            .buttonStyle(.plain)
            .foregroundStyle(Theme.accent)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 10, trailing: 16))
            checkpointSection
            Button("この日を削除") {
                showsDeleteConfirmation = true
            }
            .font(.subheadline)
            .buttonStyle(.plain)
            .foregroundStyle(Theme.danger)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 22, leading: 16, bottom: 16, trailing: 16))
        }
    }

    private var summaryRow: some View {
        HStack(spacing: 8) {
            Text(day.title?.isEmpty == false ? (day.title ?? "") : "この日")
                .font(.headline)
                .foregroundStyle(Theme.ink)
                .lineLimit(2)
            Spacer(minLength: 4)
        }
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 6, trailing: 16))
    }

    private var statsRow: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), alignment: .leading),
                      GridItem(.flexible(), alignment: .leading)],
            spacing: 12
        ) {
            StatCell(label: "日付", value: displayDate)
            StatCell(label: "出発時刻", value: day.departureTime ?? "—")
            // 走行距離は解決済みレグが道路距離・未解決レグが直線距離の概算なので常に「約」
            StatCell(
                label: "走行",
                value: dayLegs.isEmpty
                    ? "—"
                    : "約\(ContentView.formatDistance(RouteLegDistance.totalMeters(legs: dayLegs, resolved: resolvedLegs)))"
            )
        }
        .padding(.vertical, 6)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 4, trailing: 16))
    }

    @ViewBuilder
    private var checkpointSection: some View {
        PanelLabel(text: "CHECKPOINTS")
            .padding(.top, 12)
            .padding(.bottom, 2)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        let checkpoints = day.sortedCheckpoints
        if checkpoints.isEmpty {
            Text("チェックポイントがありません")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        }
        let estimates = arrivalEstimates
        ForEach(checkpoints) { checkpoint in
            Button {
                editingCheckpoint = checkpoint
            } label: {
                CheckpointRow(
                    checkpoint: checkpoint,
                    estimatedArrival: estimates[checkpoint.id]
                )
            }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 9, leading: 16, bottom: 9, trailing: 16))
            // 行タップは編集に割り当て済みなので、外部地図への転送は長押しで
            .contextMenu {
                if let latitude = checkpoint.latitude,
                   let longitude = checkpoint.longitude {
                    Button {
                        openURL(GoogleMapsLink.searchURL(
                            latitude: latitude, longitude: longitude
                        ))
                    } label: {
                        Label("Google Maps で開く", systemImage: "arrow.up.right.square")
                    }
                }
            }
        }
        .onMove { source, destination in
            var ordered = day.sortedCheckpoints
            ordered.move(fromOffsets: source, toOffset: destination)
            PlanEditor.applyOrder(ordered)
            try? modelContext.save()
            Task { await sync.syncNow() }
        }
        .onDelete { offsets in
            let checkpoints = day.sortedCheckpoints
            for index in offsets {
                PlanEditor.delete(checkpoints[index])
            }
            try? modelContext.save()
            Task { await sync.syncNow() }
        }
        HStack(spacing: 18) {
            Button {
                showsLinkAdd = true
            } label: {
                Label("リンクから追加", systemImage: "link")
            }
            Button {
                showsManualAdd = true
            } label: {
                Label("テキストを追加", systemImage: "plus")
            }
            Spacer(minLength: 0)
        }
        .font(.subheadline)
        .buttonStyle(.plain)
        .foregroundStyle(Theme.accent)
        .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 10, trailing: 16))
    }

    // MARK: - 操作・導出

    /// リンクの結果はそのまま追加する(種別は一律 sightseeing。行タップで直せる)。
    /// 座標が取れなかったリンクは座標未設定のまま追加する(あとから編集で設定できる)
    private func addCheckpoint(from place: PlaceSelection) {
        let checkpoint = PlanEditor.makeCheckpoint(
            name: place.name,
            type: place.suggestedType,
            latitude: place.latitude,
            longitude: place.longitude,
            in: day
        )
        modelContext.insert(checkpoint)
        try? modelContext.save()
        Task { await sync.syncNow() }
    }

    private var checkpointAnnotations: [TripCheckpointAnnotation] {
        day.sortedCheckpoints.compactMap(TripCheckpointAnnotation.make)
    }

    /// ルートの起点 = 前日までの最後の座標ありチェックポイント(前泊地など)
    private var routeStart: CLLocationCoordinate2D? {
        guard
            let trip = day.trip,
            let index = trip.sortedDays.firstIndex(where: { $0.id == day.id })
        else { return nil }
        return TripDetailView.routeAnchor(before: index, in: trip.sortedDays)
    }

    /// この日のルート座標列(前泊地起点 + 訪問順のチェックポイント)
    private var dayRoute: [CLLocationCoordinate2D] {
        let coordinates = checkpointAnnotations.map(\.coordinate)
        guard let routeStart else { return coordinates }
        return [routeStart] + coordinates
    }

    /// この日のレグ列(TripMapView が planRoute から組むものと同じキーになる)
    private var dayLegs: [RouteLeg] {
        RouteLegBuilder.legs(through: dayRoute.map(\.routePoint))
    }

    /// 各チェックポイントの到着予想時刻(手入力 plannedTime のある CP は含まれない)
    private var arrivalEstimates: [UUID: Date] {
        ArrivalEstimator.estimates(
            dayDate: day.date,
            departureTime: day.departureTime,
            routeStart: routeStart?.routePoint,
            checkpoints: day.sortedCheckpoints,
            resolvedLegs: resolvedLegs
        )
    }

    private var dayTitle: String {
        let date = PlanEditor.displayDate(day.date)
        if let index = day.trip?.sortedDays.firstIndex(where: { $0.id == day.id }) {
            return "\(index + 1)日目 · \(date)"
        }
        // 旅行に紐付いておらず番号が出せないときは日付だけ
        return date
    }

    private var displayDate: String {
        guard let date = PlanEditor.parseDate(day.date) else { return day.date }
        return date.formatted(.dateTime.year().month().day().weekday())
    }
}

/// 日の行程タイトル・メモを編集するフォーム
struct TripDayEditView: View {
    let day: TripDayEntity

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var title: String
    @State private var note: String
    @State private var hasDepartureTime: Bool
    @State private var departureTime: Date

    init(day: TripDayEntity) {
        self.day = day
        _title = State(initialValue: day.title ?? "")
        _note = State(initialValue: day.note ?? "")
        _hasDepartureTime = State(initialValue: day.departureTime != nil)
        _departureTime = State(
            initialValue: ArrivalEstimator.departureDate(
                dayDate: day.date, departureTime: day.departureTime
            ) ?? Self.defaultDepartureTime(for: day)
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("行程(例: 松本周辺を観光して泊)", text: $title)
                    TextField("メモ", text: $note, axis: .vertical)
                }
                Section {
                    Toggle("出発時刻を設定", isOn: $hasDepartureTime)
                    if hasDepartureTime {
                        DatePicker(
                            "出発時刻",
                            selection: $departureTime,
                            displayedComponents: [.hourAndMinute]
                        )
                    }
                } footer: {
                    Text("この日の宿泊地(前泊地)を出発する時刻。以降のチェックポイントの到着予想に使います。")
                }
            }
            .navigationTitle("行程を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存", action: save)
                }
            }
        }
    }

    private func save() {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        day.title = trimmedTitle.isEmpty ? nil : trimmedTitle
        day.note = trimmedNote.isEmpty ? nil : trimmedNote
        day.departureTime = hasDepartureTime ? PlanEditor.timeString(departureTime) : nil
        day.updatedAt = Date()
        day.needsSync = true
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
    }

    /// 出発時刻の初期値はその日の 8:00
    private static func defaultDepartureTime(for day: TripDayEntity) -> Date {
        guard let date = PlanEditor.parseDate(day.date) else { return Date() }
        return Calendar.current.date(bySettingHour: 8, minute: 0, second: 0, of: date) ?? date
    }
}

/// チェックポイントの一覧行(種別の点・名前・種別ラベル・予定時刻 or 到着予想・メモ)
struct CheckpointRow: View {
    let checkpoint: CheckpointEntity
    /// 到着予想時刻(手入力の plannedTime がある CP は予想を出さず plannedTime を表示する)
    var estimatedArrival: Date?

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            // 地図のピンと同じ種別色の点で結びつける
            Circle()
                .fill(checkpoint.type.tint)
                .frame(width: 10, height: 10)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(checkpoint.name)
                    .foregroundStyle(Theme.ink)
                HStack(spacing: 8) {
                    Text(checkpoint.type.label)
                    if checkpoint.latitude == nil {
                        Text("座標未設定")
                    }
                }
                .font(Theme.numeric(.caption))
                .foregroundStyle(Theme.muted)
                if let note = checkpoint.note, !note.isEmpty {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            timeText
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var timeText: some View {
        if let plannedTime = checkpoint.plannedTime {
            Text(plannedTime, format: .dateTime.hour().minute())
                .font(Theme.numeric(.subheadline))
                .foregroundStyle(Theme.accent)
        } else if let estimatedArrival {
            // OSRM の自由流走行時間ベースで渋滞・休憩を含まない概算なので常に「頃」
            Text("\(estimatedArrival, format: .dateTime.hour().minute()) 頃")
                .font(Theme.numeric(.subheadline))
                .foregroundStyle(Theme.accent)
        }
    }
}
