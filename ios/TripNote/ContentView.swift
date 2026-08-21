import SwiftData
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(LocationRecorder.self) private var recorder
    @Query(sort: \TripEntity.startedAt, order: .reverse) private var trips: [TripEntity]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    recordingSection
                }
                Section("旅行") {
                    if trips.isEmpty {
                        Text("まだ記録がありません")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(trips) { trip in
                        TripRow(trip: trip)
                    }
                }
            }
            .navigationTitle("trip-note")
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
            Button("記録を停止", role: .destructive) {
                recorder.stopRecording()
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
