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
    /// 権限リクエストの応答待ちで記録開始が保留されている trip
    private var pendingTrip: TripEntity?

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

    /// 指定した旅行への記録を開始する(旅行詳細画面から呼ぶ)。
    /// 未出発(プラン中)の旅行はここで startedAt が入り進行中になる
    func startRecording(trip: TripEntity) {
        guard !isRecording else { return }
        lastError = nil
        switch manager.authorizationStatus {
        case .notDetermined:
            pendingTrip = trip
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            lastError = "位置情報へのアクセスが許可されていません。設定アプリから許可してください。"
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
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        isRecording = false
        activeTrip = nil
        lastRecorded = nil
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

    /// 起動時に呼ぶ。記録中のまま終了された trip があれば記録を再開する。
    /// バックグラウンドでの再起動(significant location change)時にも UI なしで動く。
    func resumeIfNeeded() {
        guard !isRecording, isAuthorized else { return }
        var descriptor = FetchDescriptor<TripEntity>(
            predicate: #Predicate { $0.isRecordingActive && $0.deletedAt == nil }
        )
        descriptor.fetchLimit = 1
        guard let trip = try? modelContext.fetch(descriptor).first else { return }
        resume(trip: trip)
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
            pendingTrip = nil
            if isRecording {
                stopRecording()
                lastError = "位置情報へのアクセスが取り消されたため記録を停止しました。"
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
