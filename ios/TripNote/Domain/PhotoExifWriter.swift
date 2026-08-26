import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// 撮影日時と撮影位置を EXIF に書いた JPEG を作るロジック(純関数)。
///
/// アプリ内カメラの撮影結果は `UIImage` なので、そのまま JPEG にすると EXIF を持たない。
/// 写真アプリの中での日付・場所は `PHAssetCreationRequest` の `creationDate` / `location` で
/// 正しくなるが、そこから書き出したファイル自身には何も残らない(他アプリへ渡した先で
/// 撮影日時が分からない)ため、ファイルにも持たせる。
///
/// 書き込む書式は読み側(`MediaCaptureTime` / `MediaCoordinate`)に合わせる。
enum PhotoExifWriter {
    /// EXIF(DateTimeOriginal / OffsetTimeOriginal)と GPS を付けた JPEG を作る。
    /// 画像として書き出せなければ nil。
    ///
    /// 撮影直後にメインスレッドで回すと画面が固まるため、`MediaImporter.encodeJPEG` と
    /// 同じく async(nonisolated)にしてメインスレッドから外す。
    static func jpegData(
        from image: UIImage,
        takenAt: Date,
        coordinate: MediaCoordinate.Coordinate?,
        quality: CGFloat,
        timeZone: TimeZone = .current
    ) async -> Data? {
        // EXIF を積めない画像(cgImage を持たない)は素の JPEG で返す。
        // 写真アプリ内の日付・場所は PhotoLibrarySaver が付けるので、
        // 失うのは書き出したファイル自身のメタデータだけ
        guard let cgImage = image.cgImage else {
            return image.jpegData(compressionQuality: quality)
        }
        let output = NSMutableData()
        guard
            let destination = CGImageDestinationCreateWithData(
                output, UTType.jpeg.identifier as CFString, 1, nil
            )
        else { return nil }

        var properties: [CFString: Any] = [
            // cgImage は回転前の画素なので、UIImage の向きをタグとして持たせる
            // (UIImage.jpegData と同じ扱い)
            kCGImagePropertyOrientation: exifOrientation(image.imageOrientation),
            kCGImageDestinationLossyCompressionQuality: quality,
            kCGImagePropertyExifDictionary: exifDictionary(takenAt: takenAt, timeZone: timeZone),
        ]
        if let coordinate {
            properties[kCGImagePropertyGPSDictionary] = gpsDictionary(coordinate)
        }
        CGImageDestinationAddImage(destination, cgImage, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }

    // MARK: - EXIF

    private static func exifDictionary(takenAt: Date, timeZone: TimeZone) -> [CFString: Any] {
        [
            // タイムゾーンを持たない壁時計時刻 + オフセットの組(EXIF 2.31)
            kCGImagePropertyExifDateTimeOriginal: dateTimeText(takenAt, timeZone: timeZone),
            kCGImagePropertyExifOffsetTimeOriginal: offsetText(takenAt, timeZone: timeZone),
        ]
    }

    private static func gpsDictionary(_ coordinate: MediaCoordinate.Coordinate) -> [CFString: Any] {
        // GPS の値は常に正で、南緯・西経は Ref で示す
        [
            kCGImagePropertyGPSLatitude: abs(coordinate.latitude),
            kCGImagePropertyGPSLatitudeRef: coordinate.latitude < 0 ? "S" : "N",
            kCGImagePropertyGPSLongitude: abs(coordinate.longitude),
            kCGImagePropertyGPSLongitudeRef: coordinate.longitude < 0 ? "W" : "E",
        ]
    }

    private static func dateTimeText(_ date: Date, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        formatter.timeZone = timeZone
        return formatter.string(from: date)
    }

    /// "+09:00" / "-07:00" 形式のオフセット
    private static func offsetText(_ date: Date, timeZone: TimeZone) -> String {
        let seconds = timeZone.secondsFromGMT(for: date)
        let sign = seconds < 0 ? "-" : "+"
        let minutes = abs(seconds) / 60
        return String(format: "%@%02d:%02d", sign, minutes / 60, minutes % 60)
    }

    /// UIImage の向きを EXIF の Orientation(1〜8)に直す
    private static func exifOrientation(_ orientation: UIImage.Orientation) -> UInt32 {
        switch orientation {
        case .up: return 1
        case .upMirrored: return 2
        case .down: return 3
        case .downMirrored: return 4
        case .leftMirrored: return 5
        case .right: return 6
        case .rightMirrored: return 7
        case .left: return 8
        @unknown default: return 1
        }
    }
}
