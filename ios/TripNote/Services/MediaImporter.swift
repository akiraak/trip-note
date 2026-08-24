import AVFoundation
import Foundation
import ImageIO
import Observation
// PhotosPickerItem(PhotosUI の SwiftUI オーバーレイ)を使うため SwiftUI も要る
import PhotosUI
import SwiftData
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// 撮影・ライブラリ取り込みされた写真/動画を圧縮・変換してローカル保存し、
/// 撮影時刻に最も近い記録点に紐付けて MediaEntity を作るサービス。
/// 圧縮方針は docs/specs/phase4-media.md 参照。
@MainActor
@Observable
final class MediaImporter {
    /// 写真の最大辺(px)。HEIC はブラウザ互換のため JPEG に変換する
    nonisolated static let photoMaxDimension: CGFloat = 2560
    nonisolated static let thumbnailMaxDimension: CGFloat = 480

    enum MediaImportError: LocalizedError {
        case encodingFailed

        var errorDescription: String? {
            switch self {
            case .encodingFailed:
                return "画像を変換できませんでした"
            }
        }
    }

    private let modelContext: ModelContext
    let store: MediaStore

    private(set) var isImporting = false
    private(set) var lastError: String?

    init(modelContext: ModelContext, store: MediaStore = .makeDefault()) {
        self.modelContext = modelContext
        self.store = store
    }

    // MARK: - 写真

    /// カメラ撮影した写真を保存する
    func importPhoto(_ image: UIImage, into trip: TripEntity, takenAt: Date) async {
        isImporting = true
        defer { isImporting = false }
        do {
            let id = UUID()
            let full = try await Self.encodeJPEG(image, maxDimension: Self.photoMaxDimension, quality: 0.85)
            let thumbnail = try await Self.encodeJPEG(image, maxDimension: Self.thumbnailMaxDimension, quality: 0.7)
            let fileName = "\(id.uuidString).jpg"
            let thumbnailFileName = "\(id.uuidString)-thumb.jpg"
            try store.write(full, fileName: fileName)
            try store.write(thumbnail, fileName: thumbnailFileName)
            insert(id: id, type: .photo, fileName: fileName,
                   thumbnailFileName: thumbnailFileName, takenAt: takenAt, trip: trip)
        } catch {
            lastError = "写真の保存に失敗しました: \(error.localizedDescription)"
        }
    }

    /// ライブラリから取り込んだ写真を保存する(撮影時刻は EXIF から。無ければ現在時刻)
    func importPhoto(data: Data, into trip: TripEntity) async {
        guard let image = UIImage(data: data) else {
            lastError = "画像を読み込めませんでした"
            return
        }
        await importPhoto(image, into: trip, takenAt: Self.exifDate(from: data) ?? Date())
    }

    // MARK: - 動画

    /// 撮影・取り込みされた動画を保存する。takenAt が nil ならメタデータの
    /// creationDate を使う(それも無ければ現在時刻)
    func importVideo(at sourceURL: URL, into trip: TripEntity, takenAt: Date?) async {
        isImporting = true
        defer { isImporting = false }
        do {
            let id = UUID()
            // ピッカーの一時ファイルが消される前に自分の管理下へ移す
            let held = FileManager.default.temporaryDirectory
                .appending(path: "\(id.uuidString)-import.mov")
            try FileManager.default.moveItem(at: sourceURL, to: held)

            let resolvedTakenAt: Date
            if let takenAt {
                resolvedTakenAt = takenAt
            } else {
                resolvedTakenAt = await Self.videoCreationDate(url: held) ?? Date()
            }

            // H.264 mp4(720p)へ変換。失敗時は元ファイル(mov)のまま保存する
            try store.ensureDirectory()
            let fileName: String
            let mp4Name = "\(id.uuidString).mp4"
            if await Self.exportVideo(from: held, to: store.url(for: mp4Name)) {
                fileName = mp4Name
                try? FileManager.default.removeItem(at: held)
            } else {
                fileName = "\(id.uuidString).mov"
                try store.adopt(fileAt: held, fileName: fileName)
            }

            let thumbnailFileName = "\(id.uuidString)-thumb.jpg"
            if let thumbnail = await Self.videoThumbnail(url: store.url(for: fileName)) {
                try store.write(thumbnail, fileName: thumbnailFileName)
            }
            insert(id: id, type: .video, fileName: fileName,
                   thumbnailFileName: thumbnailFileName, takenAt: resolvedTakenAt, trip: trip)
        } catch {
            lastError = "動画の保存に失敗しました: \(error.localizedDescription)"
        }
    }

    // MARK: - ライブラリ

    /// PhotosPicker で選ばれた項目をまとめて取り込む
    /// (旅行画面のツールバーと記録バーの両方から使う)
    func importPicked(_ items: [PhotosPickerItem], into trip: TripEntity) async {
        for item in items {
            let isVideo = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
            if isVideo {
                if let picked = try? await item.loadTransferable(type: PickedVideo.self) {
                    await importVideo(at: picked.url, into: trip, takenAt: nil)
                }
            } else if let data = try? await item.loadTransferable(type: Data.self) {
                await importPhoto(data: data, into: trip)
            }
        }
    }

    // MARK: - 削除

    /// メディアを削除する。ローカルのファイルは即消して容量を返し、行は
    /// tombstone(deletedAt)として残す。サーバへの DELETE は次の同期
    /// (`SyncEngine.pushMedia`)が送り、成功したら行も物理削除される
    func delete(_ media: MediaEntity) {
        store.remove(fileName: media.fileName)
        store.remove(fileName: media.thumbnailFileName)
        media.deletedAt = Date()
        media.needsSync = true
        do {
            try modelContext.save()
        } catch {
            lastError = "削除に失敗しました: \(error.localizedDescription)"
        }
    }

    // MARK: - 保存

    private func insert(
        id: UUID,
        type: MediaType,
        fileName: String,
        thumbnailFileName: String,
        takenAt: Date,
        trip: TripEntity
    ) {
        let points = trip.sortedPoints
        let nearest = MediaAttachment
            .nearestIndex(recordedTimes: points.map(\.recordedAt), to: takenAt)
            .map { points[$0] }
        let media = MediaEntity(
            id: id,
            type: type,
            fileName: fileName,
            thumbnailFileName: thumbnailFileName,
            takenAt: takenAt,
            trip: trip,
            locationPoint: nearest
        )
        modelContext.insert(media)
        do {
            try modelContext.save()
        } catch {
            lastError = "保存に失敗しました: \(error.localizedDescription)"
        }
    }

    // MARK: - 変換処理(nonisolated async でメインスレッドから外す)

    nonisolated static func encodeJPEG(
        _ image: UIImage, maxDimension: CGFloat, quality: CGFloat
    ) async throws -> Data {
        let pixelSize = CGSize(
            width: image.size.width * image.scale,
            height: image.size.height * image.scale
        )
        let scale = min(1, maxDimension / max(pixelSize.width, pixelSize.height))
        let data: Data?
        if scale >= 1 {
            // 縮小不要。EXIF の orientation はブラウザ側で解釈される
            data = image.jpegData(compressionQuality: quality)
        } else {
            let newSize = CGSize(
                width: (pixelSize.width * scale).rounded(.down),
                height: (pixelSize.height * scale).rounded(.down)
            )
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let rendered = UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
                image.draw(in: CGRect(origin: .zero, size: newSize))
            }
            data = rendered.jpegData(compressionQuality: quality)
        }
        guard let data else { throw MediaImportError.encodingFailed }
        return data
    }

    /// EXIF の撮影日時(タイムゾーン情報が無いため現地時刻とみなす)
    nonisolated static func exifDate(from data: Data) -> Date? {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let exif = properties[kCGImagePropertyExifDictionary] as? [CFString: Any],
            let value = exif[kCGImagePropertyExifDateTimeOriginal] as? String
        else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        formatter.timeZone = .current
        return formatter.date(from: value)
    }

    nonisolated static func videoCreationDate(url: URL) async -> Date? {
        let asset = AVURLAsset(url: url)
        // try? がネストした Optional を平坦化するので 1 段の束縛でよい
        guard let item = try? await asset.load(.creationDate) else { return nil }
        return try? await item.load(.dateValue)
    }

    nonisolated static func exportVideo(from sourceURL: URL, to destinationURL: URL) async -> Bool {
        let asset = AVURLAsset(url: sourceURL)
        guard
            let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720)
        else { return false }
        try? FileManager.default.removeItem(at: destinationURL)
        if #available(iOS 18, *) {
            do {
                try await session.export(to: destinationURL, as: .mp4)
                return true
            } catch {
                return false
            }
        } else {
            session.outputURL = destinationURL
            session.outputFileType = .mp4
            session.shouldOptimizeForNetworkUse = true
            await session.export()
            return session.status == .completed
        }
    }

    /// 動画の先頭フレームからサムネイルを作る
    nonisolated static func videoThumbnail(url: URL) async -> Data? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: thumbnailMaxDimension, height: thumbnailMaxDimension)
        guard let result = try? await generator.image(at: .zero) else { return nil }
        return UIImage(cgImage: result.image).jpegData(compressionQuality: 0.7)
    }
}
