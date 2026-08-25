import SwiftData
import SwiftUI

/// 既存プランの続き(帰路など)を AI の日数・宿泊地候補で足すシート。
/// 入力は 目的地 + 出発日時 の 2 つだけで、出発地は既存プランの最終地点を自動で使う。
/// 候補は旅行作成時と同じ /api/ai/trip-outline から出し、採用すると
/// 入力した出発日を起点に日が増える(既存の日と重なる日付は既存の日を使う)
struct PlanExtensionView: View {
    let trip: TripEntity

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var destination = ""
    @State private var departureAt: Date
    @State private var request = ""
    @State private var suggestion: AITripOutlineSuggestion?
    @State private var isLoading = false
    @State private var errorMessage: String?

    /// 出発地(既存プランの最終地点。座標があれば AI と候補地図にも渡す)
    private let departure: PlanEditor.DeparturePlace?

    init(trip: TripEntity) {
        self.trip = trip
        departure = Self.departurePlace(of: trip)
        _departureAt = State(initialValue: Self.defaultDepartureAt(of: trip))
    }

    var body: some View {
        NavigationStack {
            Form {
                if let suggestion {
                    TripOutlineCandidates(
                        suggestion: suggestion,
                        departure: departure,
                        destinationName: trimmedDestination
                    ) { candidate in
                        adopt(candidate)
                    }
                } else {
                    conditionForm
                }
            }
            .navigationTitle("続きの行程を提案")
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
            LabeledContent("出発地", value: departure?.name ?? "未指定")
            TextField("目的地(例: シアトル)", text: $destination)
            DatePicker("出発日時", selection: $departureAt)
            TextField(
                "要望(例: 海沿いを通りたい)",
                text: $request,
                axis: .vertical
            )
        } footer: {
            Text("出発地は今のプランの最終地点です。車での移動を前提に、日数と宿泊地の候補を提案します。")
        }
        Section {
            if isLoading {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("候補を作成中…")
                }
            } else {
                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .font(.subheadline)
                }
                Button {
                    Task { await suggest() }
                } label: {
                    Label("候補を出す", systemImage: "sparkles")
                }
                .disabled(trimmedDestination.isEmpty)
            }
        } footer: {
            Text("候補の作成には 1 分ほどかかります。")
        }
    }

    private var trimmedDestination: String {
        destination.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 出発地。プランの最終地点 → 無ければ 1 日目の出発チェックポイント → nil(未指定)
    private static func departurePlace(of trip: TripEntity) -> PlanEditor.DeparturePlace? {
        if let last = PlanEditor.lastPlace(of: trip) {
            return last
        }
        guard let checkpoint = TripCreateView.departureCheckpoint(of: trip) else { return nil }
        return PlanEditor.DeparturePlace(
            name: checkpoint.name,
            latitude: checkpoint.latitude,
            longitude: checkpoint.longitude
        )
    }

    /// 出発日時の初期値(最終日の翌日 9:00。日が無ければ旅行の出発予定)
    private static func defaultDepartureAt(
        of trip: TripEntity,
        calendar: Calendar = .current,
        now: Date = Date()
    ) -> Date {
        guard
            let last = trip.sortedDays.last,
            let next = PlanEditor.nextDate(after: last.date, calendar: calendar),
            let date = PlanEditor.parseDate(next, calendar: calendar),
            let morning = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: date)
        else {
            return trip.departureAt ?? now
        }
        return morning
    }

    private func suggest() async {
        guard let client = SyncClient.fromBundle() else {
            errorMessage = "サーバが未設定です(ServerConfig.plist を確認してください)"
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        let trimmedRequest = request.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = AITripOutlineRequest(
            destination: trimmedDestination,
            departureDate: PlanEditor.dateString(departureAt),
            departureTime: PlanEditor.timeString(departureAt),
            departure: departure?.name,
            departureLatitude: departure?.latitude,
            departureLongitude: departure?.longitude,
            transport: trip.transport ?? Transport.car.rawValue,
            request: trimmedRequest.isEmpty ? nil : trimmedRequest
        )
        do {
            suggestion = try await client.suggestTripOutline(body)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// 入力した出発日を起点に、入力した目的地を最終日の到着地として採用する
    /// (旅行そのものの目的地 trip.destination は書き換えない)
    private func adopt(_ candidate: AITripOutlineCandidate) {
        let (days, checkpoints) = PlanEditor.adopt(
            candidate,
            into: trip,
            destinationLatitude: suggestion?.destinationLatitude,
            destinationLongitude: suggestion?.destinationLongitude,
            startDate: departureAt,
            destinationName: trimmedDestination
        )
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
}
