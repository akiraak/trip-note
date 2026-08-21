import CoreLocation
import SwiftUI

/// trip の詳細。地図と統計ヘッダ、続けて位置情報のタイムラインを表示する。
struct TripDetailView: View {
    let trip: TripEntity

    var body: some View {
        List {
            let coordinates = trip.sortedPoints.map {
                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
            }
            if !coordinates.isEmpty {
                Section {
                    TripMapView(coordinates: coordinates, isActive: trip.isActive)
                        .frame(height: 300)
                        .listRowInsets(EdgeInsets())
                }
            }
            Section {
                LabeledContent("開始") {
                    Text(trip.startedAt, format: .dateTime.year().month().day().hour().minute())
                }
                LabeledContent("終了") {
                    if let endedAt = trip.endedAt {
                        Text(endedAt, format: .dateTime.year().month().day().hour().minute())
                    } else {
                        Text("記録中")
                            .foregroundStyle(.green)
                    }
                }
                LabeledContent("地点数", value: "\(trip.points.count)")
                LabeledContent("総距離", value: ContentView.formatDistance(trip.totalDistanceMeters))
            }

            Section("タイムライン") {
                let points = trip.sortedPoints
                if points.isEmpty {
                    Text("位置情報がありません")
                        .foregroundStyle(.secondary)
                }
                ForEach(points) { point in
                    PointRow(point: point)
                }
            }
        }
        .navigationTitle(trip.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PointRow: View {
    let point: LocationPointEntity

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(point.recordedAt, format: .dateTime.month().day().hour().minute().second())
                .font(.subheadline)
            HStack(spacing: 12) {
                Text(String(format: "%.5f, %.5f", point.latitude, point.longitude))
                if let altitude = point.altitude {
                    Text(String(format: "高度 %.0f m", altitude))
                }
                if let accuracy = point.horizontalAccuracy {
                    Text(String(format: "±%.0f m", accuracy))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 1)
    }
}
