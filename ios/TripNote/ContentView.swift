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
    /// Share Extension から受け取った共有(App Group の受信箱)。あれば取り込みシートを出す
    @State private var pendingShare: PendingShare?
    /// 取り込みシートが閉じたあとに遷移する追加先の日
    @State private var shareDestinationDay: TripDayEntity?

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    syncBar
                    PanelLabel(text: "TRIPS")
                        .padding(.top, 6)
                        .padding(.leading, 4)
                    if trips.isEmpty {
                        Text("まだ記録がありません")
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                            .padding(.vertical, 24)
                            .frame(maxWidth: .infinity)
                    }
                    ForEach(trips) { trip in
                        NavigationLink(value: trip) {
                            TripCard(trip: trip)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Theme.canvas)
            .navigationTitle("旅ログ")
            .navigationDestination(for: TripEntity.self) { trip in
                TripDetailView(trip: trip)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showsTripCreate = true
                    } label: {
                        Label("旅行を作成", systemImage: "plus")
                    }
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
        .sheet(
            item: $pendingShare,
            onDismiss: {
                // スワイプで閉じても同じ共有を出し直さない(取り込み済みなら remove 済みで無害)
                if let day = shareDestinationDay, let trip = day.trip {
                    shareDestinationDay = nil
                    path = NavigationPath()
                    path.append(trip)
                    // 日詳細の navigationDestination は旅行画面の中にあるため、
                    // 旅行画面が出てから日を積む
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        path.append(day)
                    }
                }
                loadPendingShare()
            }
        ) { share in
            SharedPlaceImportView(share: share, trips: trips) { day in
                ShareInbox.shared.remove(id: share.id)
                shareDestinationDay = day
                pendingShare = nil
            }
        }
        .onOpenURL { url in
            // Share Extension の「旅ログを開く」(tripnote://share)
            if url.scheme == "tripnote" {
                loadPendingShare()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            // 記録中はローカル優先(自動同期しない)。復帰時に未同期分をまとめて送る
            if newPhase == .active {
                loadPendingShare()
                if !recorder.isRecording {
                    Task { await sync.syncNow() }
                }
            }
        }
        .task {
            loadPendingShare()
            if !recorder.isRecording {
                await sync.syncNow()
            }
        }
    }

    /// 受信箱の先頭の共有を取り込みシートに出す(表示中・作成シート中は何もしない)。
    /// 出した共有は閉じた時点で受信箱から消す
    private func loadPendingShare() {
        guard pendingShare == nil, !showsTripCreate else { return }
        guard let share = ShareInbox.shared.pending().first else { return }
        ShareInbox.shared.remove(id: share.id)
        pendingShare = share
    }

    /// 一覧の一番上に置く同期の状態と操作。
    /// ナビゲーションバーに入れると文言が潰れるので、幅の取れる行として出す
    @ViewBuilder
    private var syncBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                if sync.isSyncing {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(Theme.muted)
                }
                Text(syncStatusText)
                    .font(Theme.numeric(.caption))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 8)
                if sync.isConfigured {
                    Button {
                        Task { await sync.syncNow() }
                    } label: {
                        Label("今すぐ同期", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption)
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.accent)
                    .disabled(sync.isSyncing)
                }
            }
            if !sync.isConfigured {
                Text("Resources/ServerConfig.plist を作成すると同期できます。")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
            if let error = sync.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
    }

    private var syncStatusText: String {
        if !sync.isConfigured {
            return "サーバ未設定"
        }
        if sync.isSyncing {
            return "同期中…"
        }
        let pending = sync.pendingPointCount
        let pendingMedia = sync.pendingMediaCount
        if pending > 0 || pendingMedia > 0 {
            return "未同期: \(pending) 地点 / \(pendingMedia) メディア"
        }
        if let syncedAt = sync.lastSyncedAt {
            return "同期済み (\(syncedAt.formatted(.dateTime.hour().minute())))"
        }
        return "未同期のデータはありません"
    }

    static func formatDistance(_ meters: Double) -> String {
        if meters < 1000 {
            return String(format: "%.0f m", meters)
        }
        return String(format: "%.2f km", meters / 1000)
    }
}

/// 一覧の 1 行。左にルートのサムネイル、右にタイトルと状態・実績の数値
private struct TripCard: View {
    let trip: TripEntity

    var body: some View {
        HStack(spacing: 0) {
            RouteThumbnail(
                coordinates: trip.thumbnailRoute,
                color: trip.startedAt == nil ? Theme.accent : Theme.done
            )
            .frame(width: 96)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(trip.title)
                        .font(.body)
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                    statusTag
                }
                summary
                    .font(Theme.numeric(.caption))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 92)
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line, lineWidth: 1))
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

    @ViewBuilder
    private var summary: some View {
        if let startedAt = trip.startedAt {
            // 日時にも空白が入るので、項目の区切りは中黒で示す
            let startedText = startedAt.formatted(
                .dateTime.year().month().day().hour().minute()
            )
            let distance = ContentView.formatDistance(trip.totalDistanceMeters)
            Text("\(startedText) · \(trip.points.count) 地点 · \(distance)")
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        } else if let first = trip.sortedDays.first,
                  let date = PlanEditor.parseDate(first.date) {
            // プラン中はプランの期間を出す(地点数・距離は 0 なので出さない)
            Text("\(date.formatted(.dateTime.month().day())) から \(trip.sortedDays.count) 日間")
        } else {
            Text("未出発")
        }
    }
}
