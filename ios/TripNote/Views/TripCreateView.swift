import SwiftData
import SwiftUI

/// プラン段階の旅行を作成するフォーム。開始日と日数から trip_days も同時に作る
struct TripCreateView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var title = ""
    @State private var transport: Transport?
    @State private var startDate = Calendar.current.startOfDay(for: Date())
    @State private var dayCount = 2

    var body: some View {
        NavigationStack {
            Form {
                TextField("タイトル(例: 松本旅行)", text: $title)
                TransportPicker(transport: $transport)
                DatePicker("開始日", selection: $startDate, displayedComponents: .date)
                Stepper("日数: \(dayCount) 日", value: $dayCount, in: 1...30)
            }
            .navigationTitle("旅行を作成")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("作成", action: create)
                        .disabled(trimmedTitle.isEmpty)
                }
            }
        }
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func create() {
        let made = PlanEditor.makeTrip(
            title: trimmedTitle,
            transport: transport?.rawValue,
            startDate: startDate,
            dayCount: dayCount
        )
        modelContext.insert(made.trip)
        for day in made.days {
            modelContext.insert(day)
        }
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
    }
}

/// 旅行のタイトル・移動手段を編集するフォーム(開始/終了は記録ライフサイクル側で扱う)
struct TripEditView: View {
    let trip: TripEntity

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var title: String
    @State private var transport: Transport?

    init(trip: TripEntity) {
        self.trip = trip
        _title = State(initialValue: trip.title)
        _transport = State(initialValue: trip.transport.flatMap(Transport.init(rawValue:)))
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("タイトル", text: $title)
                TransportPicker(transport: $transport)
            }
            .navigationTitle("旅行を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存", action: save)
                        .disabled(trimmedTitle.isEmpty)
                }
            }
        }
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func save() {
        trip.title = trimmedTitle
        trip.transport = transport?.rawValue
        trip.updatedAt = Date()
        trip.needsSync = true
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
    }
}

private struct TransportPicker: View {
    @Binding var transport: Transport?

    var body: some View {
        Picker("移動手段", selection: $transport) {
            Text("未設定").tag(Transport?.none)
            ForEach(Transport.allCases, id: \.self) { transport in
                Text(transport.label).tag(Transport?.some(transport))
            }
        }
    }
}
