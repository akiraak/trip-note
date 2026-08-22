import CoreLocation
import SwiftData
import SwiftUI

/// プランの 1 日の詳細。タイトル・メモの編集とチェックポイントの CRUD・並べ替えを行う
struct TripDayDetailView: View {
    let day: TripDayEntity

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var showsDayEdit = false
    @State private var showsSearch = false
    @State private var showsManualAdd = false
    @State private var editingCheckpoint: CheckpointEntity?
    @State private var showsDeleteConfirmation = false

    var body: some View {
        List {
            // 座標が決まっているチェックポイントの地図(この日の分だけ)
            let pins = checkpointAnnotations
            if !pins.isEmpty {
                Section {
                    TripMapView(
                        segments: [],
                        isActive: false,
                        checkpointAnnotations: pins
                    )
                    .frame(height: 220)
                    .listRowInsets(EdgeInsets())
                }
            }
            Section {
                LabeledContent("日付") {
                    Text(displayDate)
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
                ForEach(checkpoints) { checkpoint in
                    Button {
                        editingCheckpoint = checkpoint
                    } label: {
                        CheckpointRow(checkpoint: checkpoint)
                    }
                    .buttonStyle(.plain)
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
                    showsSearch = true
                } label: {
                    Label("検索して追加", systemImage: "magnifyingglass")
                }
                Button {
                    showsManualAdd = true
                } label: {
                    Label("手入力で追加", systemImage: "plus")
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
        .sheet(isPresented: $showsDayEdit) {
            TripDayEditView(day: day)
        }
        .sheet(isPresented: $showsSearch) {
            CheckpointSearchView(
                region: CheckpointSearchView.regionHint(for: day.trip)
            ) { place in
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
                PlanEditor.delete(day)
                try? modelContext.save()
                dismiss()
                Task { await sync.syncNow() }
            }
        } message: {
            Text("この日のチェックポイントも削除されます。")
        }
    }

    /// 検索結果はそのまま追加する(種別は POI カテゴリから推測。行タップで直せる)
    private func addCheckpoint(from place: PlaceSelection) {
        let checkpoint = CheckpointEntity(
            type: place.suggestedType,
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            sortOrder: PlanEditor.nextSortOrder(in: day),
            trip: day.trip,
            tripDay: day
        )
        modelContext.insert(checkpoint)
        try? modelContext.save()
        Task { await sync.syncNow() }
    }

    private var checkpointAnnotations: [TripCheckpointAnnotation] {
        day.sortedCheckpoints.compactMap(TripCheckpointAnnotation.make)
    }

    private var dayTitle: String {
        if let index = day.trip?.sortedDays.firstIndex(where: { $0.id == day.id }) {
            return "\(index + 1)日目"
        }
        return "プラン"
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

    init(day: TripDayEntity) {
        self.day = day
        _title = State(initialValue: day.title ?? "")
        _note = State(initialValue: day.note ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("行程(例: 松本周辺を観光して泊)", text: $title)
                TextField("メモ", text: $note, axis: .vertical)
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
        day.updatedAt = Date()
        day.needsSync = true
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
    }
}

/// チェックポイントの一覧行(種別アイコン・名前・予定時刻・メモ)
struct CheckpointRow: View {
    let checkpoint: CheckpointEntity

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
