import MapKit
import SwiftUI

/// AI の日数・宿泊地候補(/api/ai/trip-outline の応答)を並べる Form セクション。
/// 旅行作成直後の候補ステップ(TripCreateView)と、既存プランの続きを足す
/// PlanExtensionView の両方から使う(表示内容は同じ)
struct TripOutlineCandidates: View {
    let suggestion: AITripOutlineSuggestion
    /// 出発地(候補プレビュー地図の始点。座標が無ければ地図には出ない)
    let departure: PlanEditor.DeparturePlace?
    /// 到着地の名前(地図のラベル)
    let destinationName: String?
    let onAdopt: (AITripOutlineCandidate) -> Void

    var body: some View {
        ForEach(suggestion.candidates, id: \.self) { candidate in
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(candidate.title)
                        .font(.headline)
                    Text(Self.summary(of: candidate))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                let points = Self.mapPoints(
                    for: candidate,
                    departure: departure,
                    destinationName: destinationName,
                    destinationLatitude: suggestion.destinationLatitude,
                    destinationLongitude: suggestion.destinationLongitude
                )
                if !points.isEmpty {
                    OutlineCandidateMap(points: points)
                        .frame(height: 150)
                        .listRowInsets(EdgeInsets())
                }
                Button {
                    onAdopt(candidate)
                } label: {
                    Label("この候補を採用", systemImage: "checkmark")
                }
            }
        }
        Section {
        } footer: {
            Text("採用後は通常の編集で調整できます。地図はおおよその位置です。宿の位置は採用後に Google Maps のリンクで具体化してください。")
        }
    }

    /// 候補プレビュー地図の点列(出発地 + 各泊 + 目的地。座標が無い点は飛ばす)
    static func mapPoints(
        for candidate: AITripOutlineCandidate,
        departure: PlanEditor.DeparturePlace?,
        destinationName: String?,
        destinationLatitude: Double?,
        destinationLongitude: Double?
    ) -> [OutlineMapPoint] {
        var points: [OutlineMapPoint] = []
        if let departure,
           let latitude = departure.latitude,
           let longitude = departure.longitude {
            points.append(
                OutlineMapPoint(
                    id: 0,
                    label: "出発",
                    kind: .departure,
                    coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
                )
            )
        }
        for (index, night) in candidate.nights.enumerated() {
            guard let latitude = night.latitude, let longitude = night.longitude else { continue }
            points.append(
                OutlineMapPoint(
                    id: index + 1,
                    label: "\(index + 1)泊目 \(night.area)",
                    kind: .night,
                    coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
                )
            )
        }
        if let destinationLatitude, let destinationLongitude {
            points.append(
                OutlineMapPoint(
                    id: candidate.nights.count + 1,
                    label: destinationName ?? "目的地",
                    kind: .destination,
                    coordinate: CLLocationCoordinate2D(
                        latitude: destinationLatitude,
                        longitude: destinationLongitude
                    )
                )
            )
        }
        return points
    }

    /// 例: 「2泊3日・泊: 松本 → 上高地」「1日間(日帰り)」
    static func summary(of candidate: AITripOutlineCandidate) -> String {
        let daysPart = candidate.nights.isEmpty
            ? "\(candidate.dayCount)日間(日帰り)"
            : "\(candidate.nights.count)泊\(candidate.dayCount)日"
        let areas = candidate.nights.map(\.area).filter { !$0.isEmpty }
        guard !areas.isEmpty else { return daysPart }
        return "\(daysPart)・泊: \(areas.joined(separator: " → "))"
    }
}

/// 候補プレビュー地図の 1 点(出発地・宿泊地・目的地。AI の概算座標なのでおおよその位置)
struct OutlineMapPoint: Identifiable {
    enum Kind {
        case departure
        case night
        case destination

        var checkpointType: CheckpointType {
            switch self {
            case .departure: .departure
            case .night: .lodging
            case .destination: .destination
            }
        }
    }

    let id: Int
    let label: String
    let kind: Kind
    let coordinate: CLLocationCoordinate2D
}

/// AI 候補 1 件のミニ地図。出発地・各泊・目的地をマーカー + ポリラインで表示する(操作不可)
private struct OutlineCandidateMap: View {
    let points: [OutlineMapPoint]

    var body: some View {
        Map(initialPosition: .automatic, interactionModes: []) {
            if points.count >= 2 {
                MapPolyline(coordinates: points.map(\.coordinate))
                    .stroke(
                        .blue,
                        style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
                    )
            }
            ForEach(points) { point in
                Marker(
                    point.label,
                    systemImage: point.kind.checkpointType.systemImage,
                    coordinate: point.coordinate
                )
                .tint(point.kind.checkpointType.tint)
            }
        }
        .mapStyle(.standard)
    }
}
