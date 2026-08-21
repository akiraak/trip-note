import MapKit
import SwiftUI

/// trip の軌跡をポリラインで表示する地図。
/// 個々の位置情報のドットは描画しない(数千点になり得るため)。
struct TripMapView: View {
    let coordinates: [CLLocationCoordinate2D]
    /// 記録中は最新地点のマーカーを「現在」として表示する
    let isActive: Bool

    var body: some View {
        Map(initialPosition: .automatic) {
            if coordinates.count >= 2 {
                MapPolyline(coordinates: coordinates)
                    .stroke(
                        .blue,
                        style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
                    )
            }
            if let first = coordinates.first {
                Marker("開始", systemImage: "flag.fill", coordinate: first)
                    .tint(.green)
            }
            if coordinates.count >= 2, let last = coordinates.last {
                Marker(isActive ? "現在" : "終了", systemImage: "flag.checkered", coordinate: last)
                    .tint(.red)
            }
        }
        .mapStyle(.standard)
    }
}
