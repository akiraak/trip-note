import SwiftData
import SwiftUI

/// AI 行程提案。条件を入力してサーバ(/api/ai/plan)に提案してもらい、
/// プレビューを確認してから trip_days / checkpoints として採用する。
/// 採用後は通常のプラン編集で調整できる(チェックポイントの座標は未定で入る)
struct AIPlanSuggestView: View {
    let trip: TripEntity

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var departure = ""
    @State private var destination = ""
    @State private var startDate: Date
    @State private var dayCount: Int
    @State private var request = ""
    @State private var suggestion: AIPlanSuggestion?
    @State private var isLoading = false
    @State private var errorMessage: String?

    init(trip: TripEntity) {
        self.trip = trip
        let days = trip.sortedDays
        let start = days.first.flatMap { PlanEditor.parseDate($0.date) }
            ?? trip.startedAt
            ?? Date()
        _startDate = State(initialValue: start)
        _dayCount = State(initialValue: max(days.count, 2))
    }

    var body: some View {
        NavigationStack {
            Form {
                if let suggestion {
                    preview(suggestion)
                } else {
                    conditionForm
                }
            }
            .navigationTitle("AI で行程を提案")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
            }
            .interactiveDismissDisabled(isLoading)
        }
    }

    @ViewBuilder
    private var conditionForm: some View {
        Section {
            TextField("出発地(例: 東京駅)", text: $departure)
            TextField("到着予定地(例: 自宅)", text: $destination)
            DatePicker("開始日", selection: $startDate, displayedComponents: .date)
            Stepper("日数: \(dayCount)日", value: $dayCount, in: 1...30)
            if let transport = trip.transport {
                LabeledContent(
                    "移動手段",
                    value: Transport(rawValue: transport)?.label ?? transport
                )
            }
            TextField(
                "要望(例: 城と温泉を入れたい)",
                text: $request,
                axis: .vertical
            )
        } footer: {
            Text("移動手段は旅行の設定を使います。提案の作成には 1 分ほどかかります。")
        }
        Section {
            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(.subheadline)
            }
            Button {
                Task { await suggest() }
            } label: {
                if isLoading {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("提案を作成中…")
                    }
                } else {
                    Label("提案してもらう", systemImage: "sparkles")
                }
            }
            .disabled(isLoading || trimmed(departure).isEmpty || trimmed(destination).isEmpty)
        }
    }

    @ViewBuilder
    private func preview(_ suggestion: AIPlanSuggestion) -> some View {
        ForEach(Array(suggestion.days.enumerated()), id: \.element) { index, day in
            Section {
                ForEach(day.checkpoints, id: \.self) { checkpoint in
                    HStack(spacing: 12) {
                        Image(systemName: checkpoint.type.systemImage)
                            .foregroundStyle(checkpoint.type.tint)
                            .frame(width: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(checkpoint.name)
                            if let note = checkpoint.note, !note.isEmpty {
                                Text(note)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } header: {
                Text("\(index + 1)日目 \(displayDate(day.date)) \(day.title)")
            }
        }
        Section {
            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(.subheadline)
            }
            Button {
                adopt(suggestion)
            } label: {
                Label("この内容でプランに追加", systemImage: "checkmark")
            }
            Button("条件に戻る") {
                self.suggestion = nil
                errorMessage = nil
            }
        } footer: {
            Text("採用後は通常の編集で調整できます。地点の位置は未定のため、検索で具体化してください。")
        }
    }

    private func suggest() async {
        guard let client = SyncClient.fromBundle() else {
            errorMessage = "サーバが未設定です(ServerConfig.plist を確認してください)"
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        let body = AIPlanRequest(
            departure: trimmed(departure),
            destination: trimmed(destination),
            startDate: PlanEditor.dateString(startDate),
            dayCount: dayCount,
            transport: trip.transport,
            request: trimmed(request).isEmpty ? nil : trimmed(request)
        )
        do {
            suggestion = try await client.suggestPlan(body)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func adopt(_ suggestion: AIPlanSuggestion) {
        let (days, checkpoints) = PlanEditor.adopt(suggestion, into: trip)
        for day in days {
            modelContext.insert(day)
        }
        for checkpoint in checkpoints {
            modelContext.insert(checkpoint)
        }
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
    }

    private func trimmed(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func displayDate(_ dateString: String) -> String {
        guard let date = PlanEditor.parseDate(dateString) else { return dateString }
        return date.formatted(.dateTime.month().day().weekday())
    }
}
