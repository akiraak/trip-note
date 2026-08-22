import CoreLocation
import Foundation

/// 旅行作成フォームの「現在地を出発地に設定」用の一回きりの位置取得と地名変換。
/// 記録用の LocationRecorder とは独立(記録の設定・状態に影響しない)
@MainActor
final class OneShotLocationProvider: NSObject {
    struct LocationError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation, Error>?

    /// 現在地を 1 回だけ取得する。未許可なら許可ダイアログを出し、拒否済みならエラー
    func requestLocation() async throws -> CLLocation {
        guard continuation == nil else {
            throw LocationError(message: "現在地を取得中です")
        }
        manager.delegate = self
        // 出発地の地名が分かればよいので精度は控えめ(取得も速い)
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            switch manager.authorizationStatus {
            case .notDetermined:
                // 応答は locationManagerDidChangeAuthorization で受けて requestLocation する
                manager.requestWhenInUseAuthorization()
            case .denied, .restricted:
                resume(.failure(Self.deniedError))
            default:
                manager.requestLocation()
            }
        }
    }

    /// 座標を出発地として使いやすい地名にする(取れなければ nil)
    nonisolated static func placeName(for location: CLLocation) async -> String? {
        let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first
        guard let placemark else { return nil }
        // name は POI 名や番地(例: 「松本駅」「大手3丁目」)。無ければ市区町村まで
        return placemark.name ?? placemark.subLocality ?? placemark.locality
    }

    private static var deniedError: LocationError {
        LocationError(
            message: "位置情報へのアクセスが許可されていません。設定アプリから許可してください。"
        )
    }

    private func resume(_ result: Result<CLLocation, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }
}

extension OneShotLocationProvider: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            // 許可待ち中でなければ何もしない(delegate 設定直後にも呼ばれる)
            guard self.continuation != nil else { return }
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                self.manager.requestLocation()
            case .denied, .restricted:
                self.resume(.failure(Self.deniedError))
            default:
                break
            }
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            self.resume(.success(location))
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in
            self.resume(.failure(LocationError(message: "現在地を取得できませんでした: \(message)")))
        }
    }
}
