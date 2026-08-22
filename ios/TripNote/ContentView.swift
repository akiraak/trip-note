import SwiftData
import SwiftUI

struct ContentView: View {
    @Environment(LocationRecorder.self) private var recorder
    @Environment(SyncEngine.self) private var sync
    @Environment(\.scenePhase) private var scenePhase
    // 削除済み(tombstone)は表示しない。未出発(startedAt nil)は先頭に来る
    @Query(
        filter: #Predicate<TripEntity> { $0.deletedAt == nil },
        sort: [SortDescriptor(\TripEntity.startedAt, order: .reverse)]
    ) private var trips: [TripEntity]
    @State private var showsTripCreate = false
    /// 作成シートが閉じたら旅行の中へ遷移するための path。
    /// 旅行(TripEntity)の先に日詳細(TripDayEntity)も積むため、
    /// 型付き配列ではなく NavigationPath にする(型付きだと他の型の
    /// NavigationLink が黙って無視され、タップしても遷移しない)
    @State private var path = NavigationPath()
    @State private var createdTrip: TripEntity?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section("同期") {
                    syncSection
                }
                Section("旅行") {
                    if trips.isEmpty {
                        Text("まだ記録がありません")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(trips) { trip in
                        NavigationLink(value: trip) {
                            TripRow(trip: trip)
                        }
                    }
                }
            }
            .navigationTitle("旅ログ")
            .navigationDestination(for: TripEntity.self) { trip in
                TripDetailView(trip: trip)
            }
            .toolbar {
                Button {
                    showsTripCreate = true
                } label: {
                    Label("旅行を作成", systemImage: "plus")
                }
            }
        }
        .sheet(
            isPresented: $showsTripCreate,
            onDismiss: {
                // 作成済みならその旅行の中へ(AI 候補のスキップ・採用・目的地なしのどれでも)
                if let trip = createdTrip {
                    createdTrip = nil
                    path.append(trip)
                }
            }
        ) {
            TripCreateView { trip in
                createdTrip = trip
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            // 記録中はローカル優先(自動同期しない)。復帰時に未同期分をまとめて送る
            if newPhase == .active, !recorder.isRecording {
                Task { await sync.syncNow() }
            }
        }
        .task {
            if !recorder.isRecording {
                await sync.syncNow()
            }
        }
    }

    @ViewBuilder
    private var syncSection: some View {
        if !sync.isConfigured {
            Text("サーバが未設定です。Resources/ServerConfig.plist を作成すると同期できます。")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            HStack {
                if sync.isSyncing {
                    ProgressView()
                    Text("同期中…")
                        .foregroundStyle(.secondary)
                } else {
                    let pending = sync.pendingPointCount
                    let pendingMedia = sync.pendingMediaCount
                    if pending > 0 || pendingMedia > 0 {
                        Text("未同期: \(pending) 地点 / \(pendingMedia) メディア")
                            .foregroundStyle(.secondary)
                    } else if let syncedAt = sync.lastSyncedAt {
                        Text("同期済み (\(syncedAt.formatted(.dateTime.hour().minute())))")
                            .foregroundStyle(.secondary)
                    } else {
                        Text("未同期のデータはありません")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .font(.subheadline)
            Button("今すぐ同期") {
                Task { await sync.syncNow() }
            }
            .disabled(sync.isSyncing)
            if let error = sync.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    static func formatDistance(_ meters: Double) -> String {
        if meters < 1000 {
            return String(format: "%.0f m", meters)
        }
        return String(format: "%.2f km", meters / 1000)
    }
}

private struct TripRow: View {
    let trip: TripEntity

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(trip.title)
                    .font(.headline)
                if trip.isRecordingActive {
                    badge("記録中", color: .green)
                } else if trip.status == .inProgress {
                    badge("進行中", color: .green)
                } else if trip.status == .planning {
                    badge("プラン中", color: .blue)
                }
            }
            HStack(spacing: 12) {
                if let startedAt = trip.startedAt {
                    Text(startedAt, format: .dateTime.year().month().day().hour().minute())
                    Text("\(trip.points.count) 地点")
                    Text(ContentView.formatDistance(trip.totalDistanceMeters))
                } else if let first = trip.sortedDays.first,
                          let date = PlanEditor.parseDate(first.date) {
                    // プラン中はプランの期間を出す(地点数・距離は 0 なので出さない)
                    Text("\(date.formatted(.dateTime.month().day())) から \(trip.sortedDays.count) 日間")
                } else {
                    Text("未出発")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private func badge(_ label: String, color: Color) -> some View {
        Text(label)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2), in: Capsule())
            .foregroundStyle(color)
    }
}
