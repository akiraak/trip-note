import CoreLocation
import Foundation
import Observation
import SwiftData

/// 旅行中の位置情報を記録するサービス。
/// 画面 OFF・バックグラウンドでも記録を継続し、Always 許可があればアプリが
/// システムに終了された後も significant location change による再起動で記録を再開する。
@MainActor
@Observable
final class LocationRecorder: NSObject {
    private(set) var authorizationStatus: CLAuthorizationStatus = .notDetermined
    private(set) var isRecording = false
    private(set) var recordedPointCount = 0
    private(set) var totalDistanceMeters = 0.0
    private(set) var lastError: String?
    /// 記録中のはずが更新が長く途切れている(入れ直しても戻らなかった)。記録バーの表示に使う
    private(set) var isStalled = false

    private let manager = CLLocationManager()
    private let modelContext: ModelContext
    /// 記録中の trip(撮影したメディアの紐付け先として外からも参照する)
    private(set) var activeTrip: TripEntity?
    private var lastRecorded: LocationSample?
    /// 権限リクエストの応答待ちで記録開始が保留されている trip
    private var pendingTrip: TripEntity?
    /// 位置情報の更新を最後に受け取った時刻(点として保存したかは問わない)
    private var lastLocationUpdateAt: Date?
    /// 権限ダイアログの応答待ち。待っている間は要求を重ねない
    private var isRequestingAuthorization = false
    /// フォアグラウンドの間だけ回す定期チェック
    private var watchdogTask: Task<Void, Never>?

    static let deniedMessage = "位置情報へのアクセスが許可されていません。設定アプリから許可してください。"
    /// 定期チェックの間隔
    private static let watchdogInterval: TimeInterval = 60

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        super.init()
        manager.delegate = self
        authorizationStatus = manager.authorizationStatus
    }

    // MARK: - 記録の開始 / 停止

    /// 指定した旅行への記録を開始する(旅行詳細画面から呼ぶ)。
    /// 未出発(プラン中)の旅行はここで startedAt が入り進行中になる
    func startRecording(trip: TripEntity) {
        guard !isRecording else { return }
        lastError = nil
        switch manager.authorizationStatus {
        case .notDetermined:
            pendingTrip = trip
            isRequestingAuthorization = true
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            lastError = Self.deniedMessage
        default:
            begin(trip: trip)
        }
    }

    /// 記録を停止する。旅行は終了しない(記録停止 ≠ 旅行終了)。
    /// 同じ旅行に対して記録の開始/停止は何度でも行える。
    func stopRecording() {
        guard isRecording, let trip = activeTrip else { return }
        trip.isRecordingActive = false
        saveContext()
        suspendRecording()
    }

    /// 権限が無くなったなど、ユーザーの停止操作でない理由で記録を中断する。
    /// 記録の意思(isRecordingActive)は残すので、条件が戻れば ensureRecording() が再開する
    private func suspendRecording() {
        guard isRecording else { return }
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        isRecording = false
        activeTrip = nil
        lastRecorded = nil
        lastLocationUpdateAt = nil
        isStalled = false
    }

    /// 旅行を明示的に終了する。この旅行を記録中なら記録も停止する。
    func endTrip(_ trip: TripEntity) {
        if trip.persistentModelID == activeTrip?.persistentModelID {
            stopRecording()
        }
        trip.endedAt = Date()
        trip.updatedAt = Date()
        trip.needsSync = true
        saveContext()
    }

    // MARK: - 自動復帰(watchdog)

    /// 記録の意思(`TripEntity.isRecordingActive`)と実動を突き合わせ、ずれていれば直す。
    /// 起動時・フォアグラウンド復帰・記録中の定期チェック・権限の変化から呼ぶ。
    /// バックグラウンドでの再起動(significant location change)時にも UI なしで動く。
    func ensureRecording() {
        let intended = intendedTrip()
        let now = Date()
        let action = RecordingWatchdog.decide(
            RecordingWatchdog.Input(
                isIntended: intended != nil,
                isRecording: isRecording,
                authorization: manager.authorizationStatus,
                isRequestingAuthorization: isRequestingAuthorization,
                lastUpdateAt: lastLocationUpdateAt,
                now: now
            )
        )
        switch action {
        case .none:
            break
        case .requestAuthorization:
            isRequestingAuthorization = true
            manager.requestWhenInUseAuthorization()
        case .resume:
            if let intended {
                resume(trip: intended)
            }
        case .restart:
            restartUpdates()
        case .denied:
            // 意思は消さない。設定で許可し直せば権限の変化から自動で再開する。
            // 既に出ている理由(中断の経緯など)は上書きしない
            if lastError == nil {
                lastError = Self.deniedMessage
            }
        }
        let stalled = isRecording
            && RecordingWatchdog.isStalled(lastUpdateAt: lastLocationUpdateAt, now: now)
        if isStalled != stalled {
            isStalled = stalled
        }
    }

    /// フォアグラウンドの間だけ定期チェックを回す(何度呼んでも 1 本だけ動く)。
    /// 背面は「更新が来ている ＝ 生きている」で、来ない間はアプリ自身も動けないため回さない
    func startWatchdog() {
        guard watchdogTask == nil else { return }
        watchdogTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.watchdogInterval))
                guard !Task.isCancelled else { return }
                self?.ensureRecording()
            }
        }
    }

    func stopWatchdog() {
        watchdogTask?.cancel()
        watchdogTask = nil
    }

    /// 記録 ON の意思を持つ旅行。記録中ならその旅行がそのまま意思にあたる
    private func intendedTrip() -> TripEntity? {
        if isRecording {
            return activeTrip
        }
        var descriptor = FetchDescriptor<TripEntity>(
            predicate: #Predicate {
                $0.isRecordingActive && $0.deletedAt == nil && $0.endedAt == nil
            }
        )
        descriptor.fetchLimit = 1
        return try? modelContext.fetch(descriptor).first
    }

    /// 位置情報の購読を入れ直す。記録データにも記録の意思にも触らない
    private func restartUpdates() {
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        startUpdates()
    }

    // MARK: - 内部処理

    /// 指定した旅行で記録を始める(削除済み・終了済みには記録しない)
    private func begin(trip: TripEntity) {
        guard trip.deletedAt == nil, trip.endedAt == nil else { return }
        if trip.startedAt == nil {
            trip.startedAt = Date()
            trip.updatedAt = Date()
        }
        trip.isRecordingActive = true
        trip.needsSync = true
        saveContext()
        resume(trip: trip)
    }

    private func resume(trip: TripEntity) {
        // 中断していた間のエラー(権限が無い等)は、再開できた時点で用済み
        lastError = nil
        activeTrip = trip
        let points = trip.sortedPoints
        recordedPointCount = points.count
        totalDistanceMeters = trip.totalDistanceMeters
        lastRecorded = points.last.map {
            LocationSample(
                latitude: $0.latitude,
                longitude: $0.longitude,
                altitude: $0.altitude,
                horizontalAccuracy: $0.horizontalAccuracy,
                recordedAt: $0.recordedAt
            )
        }
        startUpdates()
        isRecording = true
    }

    private func startUpdates() {
        // 開始直後は更新がまだ届かないので、ここを起点に途切れを測る
        // (入れ直した直後にまた入れ直さないためのクールダウンも兼ねる)
        lastLocationUpdateAt = Date()
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
        // Background Modes (location) を有効にしているため、記録中は画面 OFF でも更新が届く
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        // Always 許可時: アプリが終了されても大きな位置変化でシステムが再起動してくれる保険
        manager.startMonitoringSignificantLocationChanges()
    }

    fileprivate func process(_ samples: [LocationSample]) {
        guard isRecording, let trip = activeTrip else { return }
        // 記録が生きている印。フィルタで点を捨てても「更新が届いた」ことは変わらないのでここで更新する
        lastLocationUpdateAt = Date()
        if isStalled {
            isStalled = false
        }
        var didInsert = false
        for sample in samples where LocationPointFilter.shouldRecord(sample, after: lastRecorded) {
            let point = LocationPointEntity(
                latitude: sample.latitude,
                longitude: sample.longitude,
                altitude: sample.altitude,
                horizontalAccuracy: sample.horizontalAccuracy,
                recordedAt: sample.recordedAt,
                trip: trip
            )
            modelContext.insert(point)
            if let last = lastRecorded {
                totalDistanceMeters += Geo.haversineDistance(
                    lat1: last.latitude, lng1: last.longitude,
                    lat2: sample.latitude, lng2: sample.longitude
                )
            }
            lastRecorded = sample
            recordedPointCount += 1
            didInsert = true
        }
        if didInsert {
            saveContext()
        }
    }

    fileprivate func handleAuthorizationChange(_ status: CLAuthorizationStatus) {
        authorizationStatus = status
        if status != .notDetermined {
            isRequestingAuthorization = false
        }
        switch status {
        case .authorizedWhenInUse:
            // 画面 OFF 中も確実に記録するため Always への昇格を促す(表示可否はシステム判断)
            manager.requestAlwaysAuthorization()
            startIfPending()
        case .authorizedAlways:
            startIfPending()
        case .denied, .restricted:
            pendingTrip = nil
            if isRecording {
                // 意思は残したまま中断する(許可し直せば自動で再開する)
                suspendRecording()
                lastError = "位置情報が使えず記録を中断中です"
            }
        default:
            break
        }
    }

    private func startIfPending() {
        if let trip = pendingTrip {
            pendingTrip = nil
            begin(trip: trip)
        } else {
            ensureRecording()
        }
    }

    fileprivate func handleFailure(_ message: String) {
        // kCLErrorLocationUnknown などの一時的なエラーでは記録を止めない
        lastError = message
    }

    private func saveContext() {
        do {
            try modelContext.save()
        } catch {
            lastError = "保存に失敗しました: \(error.localizedDescription)"
        }
    }
}

extension LocationRecorder: CLLocationManagerDelegate {
    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        let samples = locations.map { location in
            LocationSample(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                altitude: location.verticalAccuracy >= 0 ? location.altitude : nil,
                horizontalAccuracy: location.horizontalAccuracy,
                recordedAt: location.timestamp
            )
        }
        Task { @MainActor in
            self.process(samples)
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.handleAuthorizationChange(status)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let clError = error as? CLError, clError.code == .locationUnknown {
            return
        }
        let message = error.localizedDescription
        Task { @MainActor in
            self.handleFailure(message)
        }
    }
}
