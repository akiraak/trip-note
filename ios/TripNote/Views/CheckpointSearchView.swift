import MapKit
import SwiftUI

/// MapKit Local Search の検索結果から選ばれた地点
struct PlaceSelection: Identifiable {
    let id = UUID()
    let name: String
    let latitude: Double
    let longitude: Double
    /// POI カテゴリから推測した種別(編集フォームで変更できる)
    let suggestedType: CheckpointType
}

/// MKLocalSearch で地点を検索して選ぶ画面。選択すると onSelect を呼んで閉じる
struct CheckpointSearchView: View {
    /// 検索の中心。旅行に既にある座標の周辺を渡す(nil なら全域)
    var region: MKCoordinateRegion?
    let onSelect: (PlaceSelection) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var isSearching = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("場所を検索(例: 松本城)", text: $query)
                            .submitLabel(.search)
                            .onSubmit { Task { await search() } }
                        if isSearching {
                            ProgressView()
                        }
                    }
                }
                Section {
                    if let message {
                        Text(message)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(results, id: \.self) { item in
                        Button {
                            select(item)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name ?? "名称不明")
                                if let address = item.placemark.title {
                                    Text(address)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("場所を検索")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
            }
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        isSearching = true
        message = nil
        defer { isSearching = false }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = trimmed
        if let region {
            request.region = region
        }
        do {
            let response = try await MKLocalSearch(request: request).start()
            results = response.mapItems
            if results.isEmpty {
                message = "見つかりませんでした"
            }
        } catch {
            results = []
            message = "検索に失敗しました: \(error.localizedDescription)"
        }
    }

    private func select(_ item: MKMapItem) {
        let coordinate = item.placemark.coordinate
        onSelect(
            PlaceSelection(
                name: item.name ?? query,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                suggestedType: Self.suggestedType(for: item.pointOfInterestCategory)
            )
        )
        dismiss()
    }

    /// POI カテゴリからチェックポイント種別を推測する(外れても編集フォームで直せる)
    static func suggestedType(for category: MKPointOfInterestCategory?) -> CheckpointType {
        guard let category else { return .sightseeing }
        switch category {
        case .cafe, .bakery:
            return .cafe
        case .restaurant, .brewery, .winery:
            return .restaurant
        case .hotel, .campground:
            return .lodging
        default:
            return .sightseeing
        }
    }

    /// 旅行に既にある座標(チェックポイント・記録点)の周辺を検索の中心にする
    static func regionHint(for trip: TripEntity?) -> MKCoordinateRegion? {
        guard let trip else { return nil }
        var coords = trip.checkpoints
            .filter { $0.deletedAt == nil }
            .compactMap { checkpoint -> CLLocationCoordinate2D? in
                guard let lat = checkpoint.latitude, let lng = checkpoint.longitude else {
                    return nil
                }
                return CLLocationCoordinate2D(latitude: lat, longitude: lng)
            }
        if let last = trip.sortedPoints.last {
            coords.append(CLLocationCoordinate2D(latitude: last.latitude, longitude: last.longitude))
        }
        guard !coords.isEmpty else { return nil }
        let center = CLLocationCoordinate2D(
            latitude: coords.map(\.latitude).reduce(0, +) / Double(coords.count),
            longitude: coords.map(\.longitude).reduce(0, +) / Double(coords.count)
        )
        return MKCoordinateRegion(
            center: center,
            latitudinalMeters: 100_000,
            longitudinalMeters: 100_000
        )
    }
}
