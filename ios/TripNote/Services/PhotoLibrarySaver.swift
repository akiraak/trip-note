import CoreLocation
import Foundation
import Photos

/// 写真・動画を iOS のフォトライブラリ(カメラロール)へ追加する。
/// アプリ内保存(MediaImporter / MediaStore)とは独立した「おまけの書き出し」で、
/// 失敗しても記録側(MediaEntity)には影響させない。
///
/// 権限は追加専用(`.addOnly`)。アルバムの作成・取得には読み書き権限が要るため、
/// 保存先はカメラロールのみとする(docs/specs/phase4-media.md)。
enum PhotoLibrarySaver {
    enum SaveError: LocalizedError {
        /// 権限が無い(拒否・制限)。以降の保存もすべて失敗する
        case denied
        case failed(Error)

        var errorDescription: String? {
            switch self {
            case .denied:
                return PhotoLibrarySaver.deniedMessage
            case .failed(let error):
                return "写真アプリへの保存に失敗しました: \(error.localizedDescription)"
            }
        }
    }

    static let deniedMessage = "写真アプリへの保存は許可されていません(設定 > 旅ログ > 写真)"

    /// 写真を追加する。`data` は JPEG などのファイルそのもの
    static func savePhoto(
        data: Data,
        takenAt: Date,
        coordinate: MediaCoordinate.Coordinate?
    ) async throws {
        try await save(.photo(data), takenAt: takenAt, coordinate: coordinate)
    }

    /// 動画を追加する。元ファイルは残る(呼び出し側がそのまま使い続けられる)
    static func saveVideo(
        at url: URL,
        takenAt: Date,
        coordinate: MediaCoordinate.Coordinate?
    ) async throws {
        try await save(.video(url), takenAt: takenAt, coordinate: coordinate)
    }

    /// 追加するファイルの実体。performChanges のクロージャに渡すため Sendable な値で持つ
    private enum Resource {
        case photo(Data)
        case video(URL)
    }

    private static func save(
        _ resource: Resource,
        takenAt: Date,
        coordinate: MediaCoordinate.Coordinate?
    ) async throws {
        guard await isAuthorized() else { throw SaveError.denied }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                // shouldMoveFile は既定(false)のまま。true にすると元ファイルを持って行かれ、
                // 撮影直後は MediaImporter.importVideo が、既存分の書き出しでは正本が消える
                switch resource {
                case .photo(let data):
                    request.addResource(with: .photo, data: data, options: options)
                case .video(let url):
                    // 拡張子(mp4 / mov)から種別を判断させる
                    options.originalFilename = url.lastPathComponent
                    request.addResource(with: .video, fileURL: url, options: options)
                }
                // 写真アプリ側の日付・場所はファイルのメタデータに頼らず明示的に付ける。
                // EXIF の落ちている既存分でも撮った日の位置に並ぶ
                request.creationDate = takenAt
                if let coordinate {
                    request.location = CLLocation(
                        latitude: coordinate.latitude, longitude: coordinate.longitude
                    )
                }
            }
        } catch {
            throw SaveError.failed(error)
        }
    }

    /// 追加専用の権限を確かめる(未確定なら要求する)
    private static func isAuthorized() async -> Bool {
        switch PHPhotoLibrary.authorizationStatus(for: .addOnly) {
        case .authorized, .limited:
            return true
        case .notDetermined:
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            return status == .authorized || status == .limited
        default:
            return false
        }
    }
}
