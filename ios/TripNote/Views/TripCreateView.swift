import MapKit
import SwiftData
import SwiftUI

/// プラン段階の旅行を作成するフォーム。出発日時の日付で 1 日目だけ作り
/// (日数は作成時には決めない)、目的地が入力されていれば作成後に
/// AI の日数・宿泊地候補ステップへ進む。候補を採用すると日別プランと
/// 宿泊チェックポイント(座標未定)が作られる
struct TripCreateView: View {
    /// 旅行を作成した直後に呼ばれる(呼び出し側はシートが閉じたら旅行の中へ遷移する)
    var onCreated: ((TripEntity) -> Void)?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var title = ""
    @State private var departureAt = Date()
    @State private var departurePlace = ""
    @State private var destination = ""

    /// 現在地取得(記録用の LocationRecorder とは独立)
    @State private var locationProvider = OneShotLocationProvider()
    /// 現在地から自動入力した出発地(名前 + 座標)。名前が編集されたら座標は使わない
    @State private var locatedPlace: PlanEditor.DeparturePlace?
    @State private var isLocating = false
    @State private var locationError: String?

    /// 作成済みの旅行。non-nil になったら候補ステップ
    @State private var createdTrip: TripEntity?
    /// 作成時に確定した出発地。AI 候補リクエストには SwiftData の関連を読み直さず
    /// これを直接渡す(挿入直後の逆参照のタイミングに依存しないため)
    @State private var createdDeparture: PlanEditor.DeparturePlace?
    @State private var suggestion: AITripOutlineSuggestion?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let createdTrip {
                    outlineSections(for: createdTrip)
                } else {
                    inputForm
                }
            }
            .navigationTitle(createdTrip == nil ? "旅行を作成" : "日数と宿泊地の候補")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if createdTrip == nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("キャンセル") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("作成", action: create)
                            .disabled(trimmedTitle.isEmpty)
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("スキップ") { dismiss() }
                    }
                }
            }
            .interactiveDismissDisabled(createdTrip != nil)
            .task {
                // フォームを開いたら現在地を出発地に自動入力する
                // (取得中にユーザーが入力したら上書きしない)
                if createdTrip == nil, trimmedDeparturePlace.isEmpty {
                    await fillCurrentLocation(overwritesInput: false)
                }
            }
        }
    }

    @ViewBuilder
    private var inputForm: some View {
        Section {
            TextField("タイトル(例: 松本旅行)", text: $title)
            DatePicker("出発日時", selection: $departureAt)
            HStack(spacing: 8) {
                TextField("出発地(例: 自宅)", text: $departurePlace)
                Button {
                    Task { await fillCurrentLocation() }
                } label: {
                    if isLocating {
                        ProgressView()
                    } else {
                        Label("現在地", systemImage: "location.fill")
                            .font(.subheadline)
                    }
                }
                .buttonStyle(.borderless)
                .disabled(isLocating)
                .accessibilityLabel("現在地を出発地に設定")
            }
            if let locationError {
                Text(locationError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            TextField("目的地(例: 上高地)", text: $destination)
        } footer: {
            Text("日数は決めなくて OK。出発地は 1 日目の出発チェックポイントになります。目的地を入れておくと、作成後に AI が日数と宿泊地の候補を提案します。")
        }
    }

    @ViewBuilder
    private func outlineSections(for trip: TripEntity) -> some View {
        if let suggestion {
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
                        departure: resolvedDeparture(of: trip),
                        destinationName: trip.destination,
                        destinationLatitude: suggestion.destinationLatitude,
                        destinationLongitude: suggestion.destinationLongitude
                    )
                    if !points.isEmpty {
                        OutlineCandidateMap(points: points)
                            .frame(height: 150)
                            .listRowInsets(EdgeInsets())
                    }
                    Button {
                        adopt(candidate, into: trip)
                    } label: {
                        Label("この候補を採用", systemImage: "checkmark")
                    }
                }
            }
            Section {
            } footer: {
                Text("採用後は通常の編集で調整できます。地図はおおよその位置です。宿の位置は採用後に Google Maps のリンクで具体化してください。")
            }
        } else {
            Section {
                if isLoading {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("候補を作成中…")
                    }
                } else if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .font(.subheadline)
                    Button("再試行") {
                        Task { await suggestOutline(trip) }
                    }
                }
            } footer: {
                Text("旅行は作成済みです。候補の作成には 1 分ほどかかります。スキップしても「日を追加」や AI 行程提案で後から日程を組めます。")
            }
        }
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedDestination: String {
        destination.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedDeparturePlace: String {
        departurePlace.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 1 日目の出発チェックポイント(AI 候補出しの出発地・座標に使う)
    static func departureCheckpoint(of trip: TripEntity) -> CheckpointEntity? {
        trip.sortedDays.first?.sortedCheckpoints.first { $0.type == .departure }
    }

    /// 1 日目の出発チェックポイント名(AI 行程提案の出発地初期値に使う)
    static func departureName(of trip: TripEntity) -> String? {
        departureCheckpoint(of: trip)?.name
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

    /// 現在地取得を試みて出発地欄に地名を入れる(座標も保持して作成時に使う)。
    /// overwritesInput = false は自動入力用で、取得中に手入力されていたら反映しない
    private func fillCurrentLocation(overwritesInput: Bool = true) async {
        guard !isLocating else { return }
        isLocating = true
        locationError = nil
        defer { isLocating = false }
        do {
            let location = try await locationProvider.requestLocation()
            let name = await OneShotLocationProvider.placeName(for: location) ?? "現在地"
            guard overwritesInput || trimmedDeparturePlace.isEmpty else { return }
            departurePlace = name
            locatedPlace = PlanEditor.DeparturePlace(
                name: name,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude
            )
        } catch {
            locationError = error.localizedDescription
        }
    }

    /// 作成時に確定した出発地。state を優先し、無ければ(画面の再生成後など)
    /// 1 日目の departure チェックポイントから読み直す
    private func resolvedDeparture(of trip: TripEntity) -> PlanEditor.DeparturePlace? {
        if let createdDeparture {
            return createdDeparture
        }
        guard let checkpoint = Self.departureCheckpoint(of: trip) else { return nil }
        return PlanEditor.DeparturePlace(
            name: checkpoint.name,
            latitude: checkpoint.latitude,
            longitude: checkpoint.longitude
        )
    }

    /// 入力された出発地。現在地で自動入力した名前のままなら座標付き、手入力は座標なし
    private var enteredDeparturePlace: PlanEditor.DeparturePlace? {
        let name = trimmedDeparturePlace
        guard !name.isEmpty else { return nil }
        if let locatedPlace, locatedPlace.name == name {
            return locatedPlace
        }
        return PlanEditor.DeparturePlace(name: name)
    }

    private func create() {
        let dest = trimmedDestination.isEmpty ? nil : trimmedDestination
        let departure = enteredDeparturePlace
        createdDeparture = departure
        let made = PlanEditor.makeTrip(
            title: trimmedTitle,
            // 移動手段は車に固定(選択 UI は持たない)
            transport: Transport.car.rawValue,
            departureAt: departureAt,
            destination: dest,
            departurePlace: departure
        )
        modelContext.insert(made.trip)
        for day in made.days {
            modelContext.insert(day)
        }
        for checkpoint in made.checkpoints {
            modelContext.insert(checkpoint)
        }
        try? modelContext.save()
        onCreated?(made.trip)
        Task { await sync.syncNow() }
        if dest == nil {
            dismiss()
        } else {
            createdTrip = made.trip
            Task { await suggestOutline(made.trip) }
        }
    }

    private func suggestOutline(_ trip: TripEntity) async {
        guard let destination = trip.destination, let departureAt = trip.departureAt else {
            dismiss()
            return
        }
        guard let client = SyncClient.fromBundle() else {
            errorMessage = "サーバが未設定です(ServerConfig.plist を確認してください)"
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        let departure = resolvedDeparture(of: trip)
        let body = AITripOutlineRequest(
            destination: destination,
            departureDate: PlanEditor.dateString(departureAt),
            departureTime: PlanEditor.timeString(departureAt),
            departure: departure?.name,
            departureLatitude: departure?.latitude,
            departureLongitude: departure?.longitude,
            transport: trip.transport ?? Transport.car.rawValue,
            request: nil
        )
        do {
            suggestion = try await client.suggestTripOutline(body)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func adopt(_ candidate: AITripOutlineCandidate, into trip: TripEntity) {
        let (days, checkpoints) = PlanEditor.adopt(
            candidate,
            into: trip,
            destinationLatitude: suggestion?.destinationLatitude,
            destinationLongitude: suggestion?.destinationLongitude
        )
        for day in days {
            modelContext.insert(day)
        }
        for checkpoint in checkpoints {
            modelContext.insert(checkpoint)
        }
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
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

/// 旅行のタイトル・移動手段・出発日時・目的地を編集するフォーム
/// (開始/終了は記録ライフサイクル側で扱う)
struct TripEditView: View {
    let trip: TripEntity

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncEngine.self) private var sync

    @State private var title: String
    @State private var hasDeparture: Bool
    @State private var departureAt: Date
    @State private var destination: String

    init(trip: TripEntity) {
        self.trip = trip
        _title = State(initialValue: trip.title)
        _hasDeparture = State(initialValue: trip.departureAt != nil)
        _departureAt = State(initialValue: trip.departureAt ?? Date())
        _destination = State(initialValue: trip.destination ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("タイトル", text: $title)
                Toggle("出発日時を設定", isOn: $hasDeparture.animation())
                if hasDeparture {
                    DatePicker("出発日時", selection: $departureAt)
                }
                TextField("目的地", text: $destination)
            }
            .navigationTitle("旅行を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存", action: save)
                        .disabled(trimmedTitle.isEmpty)
                }
            }
        }
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedDestination: String {
        destination.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func save() {
        trip.title = trimmedTitle
        // 移動手段は車に固定。過去の旅行も編集のたびに car へ正規化する
        trip.transport = Transport.car.rawValue
        trip.departureAt = hasDeparture ? departureAt : nil
        trip.destination = trimmedDestination.isEmpty ? nil : trimmedDestination
        trip.updatedAt = Date()
        trip.needsSync = true
        try? modelContext.save()
        dismiss()
        Task { await sync.syncNow() }
    }
}
