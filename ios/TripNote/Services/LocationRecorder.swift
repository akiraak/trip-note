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

    private let manager = CLLocationManager()
    private let modelContext: ModelContext
    /// 記録中の trip(撮影したメディアの紐付け先として外からも参照する)
    private(set) var activeTrip: TripEntity?
    private var lastRecorded: LocationSample?
    /// 権限リクエストの応答待ちで記録開始が保留されているか
    private var isStartPending = false

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        super.init()
        manager.delegate = self
        authorizationStatus = manager.authorizationStatus
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    // MARK: - 記録の開始 / 停止

    func startRecording() {
        guard !isRecording else { return }
        lastError = nil
        switch manager.authorizationStatus {
        case .notDetermined:
            isStartPending = true
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            lastError = "位置情報へのアクセスが許可されていません。設定アプリから許可してください。"
        default:
            beginTrip()
        }
    }

    func stopRecording() {
        guard isRecording, let trip = activeTrip else { return }
        trip.endedAt = Date()
        trip.needsSync = true
        saveContext()
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        isRecording = false
        activeTrip = nil
        lastRecorded = nil
    }

    /// 起動時に呼ぶ。終了していない trip があれば記録を再開する。
    /// バックグラウンドでの再起動(significant location change)時にも UI なしで動く。
    func resumeIfNeeded() {
        guard !isRecording, isAuthorized else { return }
        var descriptor = FetchDescriptor<TripEntity>(
            predicate: #Predicate { $0.endedAt == nil },
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        descriptor.fetchLimit = 1
        guard let trip = try? modelContext.fetch(descriptor).first else { return }
        resume(trip: trip)
    }

    // MARK: - 内部処理

    private func beginTrip() {
        let title = Date().formatted(.dateTime.year().month().day()) + " の旅行"
        let trip = TripEntity(title: title)
        modelContext.insert(trip)
        saveContext()
        resume(trip: trip)
    }

    private func resume(trip: TripEntity) {
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
        switch status {
        case .authorizedWhenInUse:
            // 画面 OFF 中も確実に記録するため Always への昇格を促す(表示可否はシステム判断)
            manager.requestAlwaysAuthorization()
            startIfPending()
        case .authorizedAlways:
            startIfPending()
        case .denied, .restricted:
            isStartPending = false
            if isRecording {
                stopRecording()
                lastError = "位置情報へのアクセスが取り消されたため記録を停止しました。"
            }
        default:
            break
        }
    }

    private func startIfPending() {
        if isStartPending {
            isStartPending = false
            beginTrip()
        } else {
            resumeIfNeeded()
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
