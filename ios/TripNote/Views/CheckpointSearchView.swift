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
    @State private var showsAssist = false
    @State private var assistArea = ""
    @State private var assistRequest = ""
    @State private var assistSuggestion: AISearchAssistSuggestion?
    @State private var isAssisting = false
    @State private var assistMessage: String?

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
                assistSection
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

    /// AI 検索補助。地域 + 要望からクエリ候補・地点候補をもらい、
    /// 選ぶとそのクエリで MKLocalSearch を実行する(座標の確定は地図検索に任せる)
    @ViewBuilder
    private var assistSection: some View {
        if !showsAssist {
            Section {
                Button {
                    showsAssist = true
                } label: {
                    Label("AI に候補を聞く", systemImage: "sparkles")
                }
            }
        } else {
            Section("AI に候補を聞く") {
                TextField("地域(例: 松本市周辺)", text: $assistArea)
                TextField("要望(例: 静かなカフェ)", text: $assistRequest)
                if let assistMessage {
                    Text(assistMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                Button {
                    Task { await assist() }
                } label: {
                    if isAssisting {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("候補を作成中…")
                        }
                    } else {
                        Label("候補をもらう", systemImage: "sparkles")
                    }
                }
                .disabled(
                    isAssisting
                        || assistArea.trimmingCharacters(in: .whitespaces).isEmpty
                )
            }
            if let assistSuggestion {
                Section("AI の候補(選ぶと検索します)") {
                    ForEach(assistSuggestion.queries, id: \.self) { suggestedQuery in
                        Button {
                            searchSuggested(suggestedQuery)
                        } label: {
                            Label(suggestedQuery, systemImage: "magnifyingglass")
                        }
                    }
                    ForEach(assistSuggestion.places, id: \.self) { place in
                        Button {
                            searchSuggested(place.name)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: place.type.systemImage)
                                    .foregroundStyle(place.type.tint)
                                    .frame(width: 24)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(place.name)
                                    Text(
                                        place.note.map { "\(place.area) — \($0)" }
                                            ?? place.area
                                    )
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func assist() async {
        guard let client = SyncClient.fromBundle() else {
            assistMessage = "サーバが未設定です(ServerConfig.plist を確認してください)"
            return
        }
        isAssisting = true
        assistMessage = nil
        defer { isAssisting = false }
        let trimmedRequest = assistRequest.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            assistSuggestion = try await client.searchAssist(
                AISearchAssistRequest(
                    area: assistArea.trimmingCharacters(in: .whitespacesAndNewlines),
                    type: nil,
                    request: trimmedRequest.isEmpty ? nil : trimmedRequest
                )
            )
        } catch {
            assistMessage = error.localizedDescription
        }
    }

    private func searchSuggested(_ suggestedQuery: String) {
        query = suggestedQuery
        Task { await search() }
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
