import SwiftData
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(LocationRecorder.self) private var recorder
    @Environment(SyncEngine.self) private var sync
    @Environment(MediaImporter.self) private var importer
    @Environment(\.scenePhase) private var scenePhase
    @Query(sort: \TripEntity.startedAt, order: .reverse) private var trips: [TripEntity]
    @State private var showsCamera = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    recordingSection
                }
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
            .navigationTitle("trip-note")
            .navigationDestination(for: TripEntity.self) { trip in
                TripDetailView(trip: trip)
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
        .fullScreenCover(isPresented: $showsCamera) {
            CameraPicker { result in
                showsCamera = false
                handleCapture(result)
            }
            .ignoresSafeArea()
        }
    }

    private func handleCapture(_ result: CameraPicker.CaptureResult?) {
        guard let result, let trip = recorder.activeTrip else { return }
        Task {
            switch result {
            case .photo(let image):
                await importer.importPhoto(image, into: trip, takenAt: Date())
            case .video(let url):
                await importer.importVideo(at: url, into: trip, takenAt: Date())
            }
        }
    }

    @ViewBuilder
    private var recordingSection: some View {
        if recorder.isRecording {
            VStack(alignment: .leading, spacing: 8) {
                Label("記録中", systemImage: "location.fill")
                    .foregroundStyle(.green)
                    .font(.headline)
                HStack(spacing: 16) {
                    Text("\(recorder.recordedPointCount) 地点")
                    Text(Self.formatDistance(recorder.totalDistanceMeters))
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                Text("画面を閉じても記録は続きます")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if CameraPicker.isAvailable {
                Button {
                    showsCamera = true
                } label: {
                    Label("写真・動画を撮影", systemImage: "camera")
                }
            }
            if importer.isImporting {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("メディアを取り込み中…")
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline)
            }
            if let mediaError = importer.lastError {
                Text(mediaError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            Button("記録を停止", role: .destructive) {
                recorder.stopRecording()
                Task { await sync.syncNow() }
            }
        } else {
            Button {
                recorder.startRecording()
            } label: {
                Label("記録を開始", systemImage: "record.circle")
            }
        }

        if let error = recorder.lastError {
            Text(error)
                .font(.caption)
                .foregroundStyle(.red)
        }

        if recorder.authorizationStatus == .denied || recorder.authorizationStatus == .restricted {
            Link(
                "設定アプリで位置情報を許可する",
                destination: URL(string: UIApplication.openSettingsURLString)!
            )
            .font(.caption)
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
                if trip.isActive {
                    Text("記録中")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.green.opacity(0.2), in: Capsule())
                        .foregroundStyle(.green)
                }
            }
            HStack(spacing: 12) {
                Text(trip.startedAt, format: .dateTime.year().month().day().hour().minute())
                Text("\(trip.points.count) 地点")
                Text(ContentView.formatDistance(trip.totalDistanceMeters))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
