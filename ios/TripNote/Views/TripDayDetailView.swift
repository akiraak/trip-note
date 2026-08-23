import CoreLocation
import SwiftData
import SwiftUI

/// プランの 1 日の詳細。タイトル・メモの編集とチェックポイントの CRUD・並べ替えを行う
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
    /// 到着予想用のレグ解決結果。地図(TripMapView)側と同じレグキーなので
    /// メモリ/サーバのキャッシュが効き、二重リクエストにならない
    @State private var resolvedLegs: [String: ResolvedRouteLeg] = [:]

    var body: some View {
        List {
            // 座標が決まっているチェックポイントの地図(この日の分だけ)。
            // 日別ミニ地図と同じく前泊地起点のルート(道路形状・直線フォールバック)を描く
            let pins = checkpointAnnotations
            if !pins.isEmpty {
                Section {
                    TripMapView(
                        segments: [],
                        isActive: false,
                        checkpointAnnotations: pins,
                        planRoute: dayRoute
                    )
                    .frame(height: 220)
                    .listRowInsets(EdgeInsets())
                }
            }
            Section {
                LabeledContent("日付") {
                    Text(displayDate)
                }
                if let departureTime = day.departureTime {
                    LabeledContent("出発時刻", value: departureTime)
                }
                if let title = day.title, !title.isEmpty {
                    LabeledContent("行程", value: title)
                }
                if let note = day.note, !note.isEmpty {
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Button {
                    showsDayEdit = true
                } label: {
                    Label("行程・メモを編集", systemImage: "pencil")
                }
            }
            Section("チェックポイント") {
                let checkpoints = day.sortedCheckpoints
                if checkpoints.isEmpty {
                    Text("チェックポイントがありません")
                        .foregroundStyle(.secondary)
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
                Button {
                    showsLinkAdd = true
                } label: {
                    Label("Google Maps のリンクから追加", systemImage: "link")
                }
                Button {
                    showsManualAdd = true
                } label: {
                    Label("テキストを追加", systemImage: "plus")
                }
            }
            Section {
                Button("この日を削除", role: .destructive) {
                    showsDeleteConfirmation = true
                }
            }
        }
        .navigationTitle(dayTitle)
        .navigationBarTitleDisplayMode(.inline)
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

    /// この日のルート座標列(前泊地起点 + 訪問順のチェックポイント)。日別ミニ地図と同じ扱い
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

/// チェックポイントの一覧行(種別アイコン・名前・予定時刻 or 到着予想・メモ)
struct CheckpointRow: View {
    let checkpoint: CheckpointEntity
    /// 到着予想時刻(手入力の plannedTime がある CP は予想を出さず plannedTime を表示する)
    var estimatedArrival: Date?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: checkpoint.type.systemImage)
                .foregroundStyle(checkpoint.type.tint)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(checkpoint.name)
                HStack(spacing: 8) {
                    Text(checkpoint.type.label)
                    if let plannedTime = checkpoint.plannedTime {
                        Text(plannedTime, format: .dateTime.hour().minute())
                    } else if let estimatedArrival {
                        // OSRM の自由流走行時間ベースで渋滞・休憩を含まない概算なので常に「頃」
                        Text("到着 \(estimatedArrival, format: .dateTime.hour().minute())頃")
                    }
                    if checkpoint.latitude == nil {
                        Text("座標未設定")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let note = checkpoint.note, !note.isEmpty {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .contentShape(Rectangle())
    }
}
