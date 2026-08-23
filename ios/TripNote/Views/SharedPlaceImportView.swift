import MapKit
import SwiftData
import SwiftUI

/// 共有シート(Share Extension)で受け取った Google Maps の場所を、旅行 / 日を選んで
/// チェックポイントとして追加するシート。座標はサーバでリンクを展開して取り、
/// 取れなければ座標未設定のまま追加する(位置はあとから編集でリンクを貼って設定する)
struct SharedPlaceImportView: View {
    let share: PendingShare
    /// ContentView の一覧と同じ並び(先頭が既定の旅行)
    let trips: [TripEntity]
    /// 追加したら追加先の日を、キャンセルなら nil を返す
    let onFinish: (TripDayEntity?) -> Void

    @Environment(\.modelContext) private var modelContext
    @Environment(SyncEngine.self) private var sync
    @State private var name = ""
    @State private var type: CheckpointType = .sightseeing
    @State private var latitude: Double?
    @State private var longitude: Double?
    /// 座標がピンではない(地図の中心・住所からの推定)ときの注記
    @State private var approximationNote: String?
    @State private var selectedTripID: UUID?
    @State private var selectedDayID: UUID?
    @State private var isResolving = true
    @State private var resolveMessage: String?

    private var selectedTrip: TripEntity? {
        trips.first { $0.id == selectedTripID }
    }

    private var selectedDay: TripDayEntity? {
        selectedTrip?.sortedDays.first { $0.id == selectedDayID }
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canAdd: Bool {
        !isResolving && !trimmedName.isEmpty && selectedDay != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                placeSection
                targetSection
            }
            .navigationTitle("共有された場所を追加")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { onFinish(nil) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("追加", action: add)
                        .disabled(!canAdd)
                }
            }
            .task {
                setDefaultTarget()
                await resolve()
            }
            .onChange(of: selectedTripID) { _, _ in
                selectedDayID = selectedTrip.flatMap {
                    SharedPlaceImport.defaultDay(in: $0, today: PlanEditor.dateString(Date()))
                }?.id
            }
        }
    }

    @ViewBuilder
    private var placeSection: some View {
        Section {
            if isResolving {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("リンクから場所を取得中…")
                        .foregroundStyle(.secondary)
                }
            }
            TextField("名前", text: $name)
            Picker("種別", selection: $type) {
                ForEach(CheckpointType.allCases, id: \.self) { type in
                    Label(type.label, systemImage: type.systemImage)
                        .tag(type)
                }
            }
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
                .id("\(latitude),\(longitude)")
                if let approximationNote {
                    Text(approximationNote)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !isResolving {
                Text(resolveMessage ?? "座標未設定")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("場所")
        } footer: {
            if let resolveMessage, latitude != nil {
                Text(resolveMessage)
            }
        }
    }

    @ViewBuilder
    private var targetSection: some View {
        Section("追加先") {
            if trips.isEmpty {
                Text("旅行がありません。先に旅行を作成してください")
                    .foregroundStyle(.secondary)
            } else {
                Picker("旅行", selection: $selectedTripID) {
                    ForEach(trips) { trip in
                        Text(trip.title).tag(Optional(trip.id))
                    }
                }
                if let selectedTrip {
                    if selectedTrip.sortedDays.isEmpty {
                        Text("この旅行には日がありません。旅行画面で日を追加してください")
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("日", selection: $selectedDayID) {
                            ForEach(selectedTrip.sortedDays) { day in
                                Text(dayLabel(day)).tag(Optional(day.id))
                            }
                        }
                    }
                }
            }
        }
    }

    private func dayLabel(_ day: TripDayEntity) -> String {
        let date = PlanEditor.parseDate(day.date).map { $0.formatted(.dateTime.month().day()) }
            ?? day.date
        if let title = day.title, !title.isEmpty {
            return "\(date) \(title)"
        }
        return date
    }

    private func setDefaultTarget() {
        guard selectedTripID == nil, let trip = SharedPlaceImport.defaultTrip(in: trips) else {
            return
        }
        selectedTripID = trip.id
        selectedDayID = SharedPlaceImport.defaultDay(in: trip, today: PlanEditor.dateString(Date()))?.id
    }

    private func resolve() async {
        name = SharedPlaceImport.placeName(resolved: nil, share: share)
        defer { isResolving = false }
        guard let link = share.link else {
            resolveMessage = "Google Maps のリンクが含まれていません"
            return
        }
        guard let client = SyncClient.fromBundle() else {
            resolveMessage = "サーバが未設定のため座標を取れません。座標未設定のまま追加できます(位置はあとから編集でリンクを貼って設定できます)"
            return
        }
        do {
            let place = try await client.resolveGoogleMapsLink(link)
            name = SharedPlaceImport.placeName(resolved: place, share: share)
            latitude = place.latitude
            longitude = place.longitude
            approximationNote = place.approximationNote
            if !place.hasCoordinate {
                resolveMessage = "リンクから座標が取れませんでした。座標未設定のまま追加できます(位置はあとから編集でリンクを貼って設定できます)"
            }
        } catch {
            resolveMessage = "リンクを解決できませんでした: \(error.localizedDescription)"
        }
    }

    private func add() {
        guard let day = selectedDay else { return }
        let checkpoint = PlanEditor.makeCheckpoint(
            name: trimmedName,
            type: type,
            latitude: latitude,
            longitude: longitude,
            in: day
        )
        modelContext.insert(checkpoint)
        try? modelContext.save()
        Task { await sync.syncNow() }
        onFinish(day)
    }
}
