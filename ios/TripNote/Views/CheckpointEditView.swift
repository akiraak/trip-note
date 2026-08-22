import MapKit
import SwiftData
import SwiftUI

/// チェックポイントの作成・編集フォーム。
/// checkpoint == nil なら新規作成(その日の末尾に追加)、あれば編集
struct CheckpointEditView: View {
    let day: TripDayEntity
    var checkpoint: CheckpointEntity?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var type: CheckpointType
    @State private var name: String
    @State private var note: String
    @State private var hasPlannedTime: Bool
    @State private var plannedTime: Date
    @State private var latitude: Double?
    @State private var longitude: Double?
    @State private var showsSearch = false

    init(day: TripDayEntity, checkpoint: CheckpointEntity? = nil) {
        self.day = day
        self.checkpoint = checkpoint
        _type = State(initialValue: checkpoint?.type ?? .sightseeing)
        _name = State(initialValue: checkpoint?.name ?? "")
        _note = State(initialValue: checkpoint?.note ?? "")
        _hasPlannedTime = State(initialValue: checkpoint?.plannedTime != nil)
        _plannedTime = State(
            initialValue: checkpoint?.plannedTime ?? Self.defaultPlannedTime(for: day)
        )
        _latitude = State(initialValue: checkpoint?.latitude)
        _longitude = State(initialValue: checkpoint?.longitude)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("名前", text: $name)
                    Picker("種別", selection: $type) {
                        ForEach(CheckpointType.allCases, id: \.self) { type in
                            Label(type.label, systemImage: type.systemImage)
                                .tag(type)
                        }
                    }
                    TextField("メモ", text: $note, axis: .vertical)
                }
                Section {
                    Toggle("予定時刻を設定", isOn: $hasPlannedTime)
                    if hasPlannedTime {
                        DatePicker(
                            "予定時刻",
                            selection: $plannedTime,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                    }
                }
                Section {
                    locationSection
                } header: {
                    Text("位置")
                } footer: {
                    if latitude == nil {
                        Text("地域だけ決まっている段階なら座標未設定のままで構いません。")
                    }
                }
            }
            .navigationTitle(checkpoint == nil ? "チェックポイントを追加" : "チェックポイントを編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存", action: save)
                        .disabled(trimmedName.isEmpty)
                }
            }
            .sheet(isPresented: $showsSearch) {
                CheckpointSearchView(
                    region: CheckpointSearchView.regionHint(for: day.trip)
                ) { place in
                    // 名前・種別も常に検索結果で置き換える(目的地 CP をホテル検索で
                    // 宿泊にまとめて差し替える動線)。保存するまで確定しないので
                    // 意図しない置き換えはキャンセルで戻せる
                    name = place.name
                    type = place.suggestedType
                    latitude = place.latitude
                    longitude = place.longitude
                }
            }
        }
    }

    @ViewBuilder
    private var locationSection: some View {
        if let latitude, let longitude {
            let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            Map(
                initialPosition: .region(
                    MKCoordinateRegion(
                        center: coordinate,
                        latitudinalMeters: 2_000,
                        longitudinalMeters: 2_000
                    )
                )
            ) {
                Marker(trimmedName.isEmpty ? "位置" : trimmedName,
                       systemImage: type.systemImage,
                       coordinate: coordinate)
                    .tint(type.tint)
            }
            .frame(height: 160)
            .allowsHitTesting(false)
            .listRowInsets(EdgeInsets())
            // 検索で座標が変わったら initialPosition を作り直す
            .id("\(latitude),\(longitude)")
            Text(String(format: "%.5f, %.5f", latitude, longitude))
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("座標をクリア") {
                self.latitude = nil
                self.longitude = nil
            }
        } else {
            Text("座標未設定")
                .foregroundStyle(.secondary)
        }
        Button {
            showsSearch = true
        } label: {
            Label("検索して位置を設定", systemImage: "magnifyingglass")
        }
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func save() {
        let now = Date()
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if let checkpoint {
            checkpoint.typeRawValue = type.rawValue
            checkpoint.name = trimmedName
            checkpoint.latitude = latitude
            checkpoint.longitude = longitude
            checkpoint.plannedTime = hasPlannedTime ? plannedTime : nil
            checkpoint.note = trimmedNote.isEmpty ? nil : trimmedNote
            checkpoint.updatedAt = now
            checkpoint.needsSync = true
        } else {
            let checkpoint = CheckpointEntity(
                type: type,
                name: trimmedName,
                latitude: latitude,
                longitude: longitude,
                plannedTime: hasPlannedTime ? plannedTime : nil,
                note: trimmedNote.isEmpty ? nil : trimmedNote,
                sortOrder: PlanEditor.nextSortOrder(in: day),
                updatedAt: now,
                trip: day.trip,
                tripDay: day
            )
            modelContext.insert(checkpoint)
        }
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
    }

    /// 予定時刻の初期値はその日の 12:00
    private static func defaultPlannedTime(for day: TripDayEntity) -> Date {
        guard let date = PlanEditor.parseDate(day.date) else { return Date() }
        return Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: date) ?? date
    }
}
