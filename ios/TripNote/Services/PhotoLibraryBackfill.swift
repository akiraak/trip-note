#if DEBUG
import Foundation
import SwiftData
import UIKit

/// 【一時コード】写真アプリ保存の対応前に撮った写真・動画をまとめてフォトライブラリへ入れる。
/// 実機で 1 回流したら、このファイルと ContentView の呼び出しごと削除する
/// (docs/plans/save-captures-to-photo-library.md の Phase 4 / Phase 6)。
///
/// - 恒久機能にしないため、`MediaEntity` にフィールドを足さず UI の導線も作らない
/// - 進捗は `UserDefaults` の `debug.` キー 1 個だけに持つ(削除後に残っても実害は無い)
@MainActor
enum PhotoLibraryBackfill {
    /// 進捗の置き場。cutoff と済んだ id をこの 1 キーにまとめる
    private static let defaultsKey = "debug.photoLibraryBackfill"

    /// 起動時に 1 回呼ぶ。対象が無ければ何も出さずに終わる
    static func runIfNeeded(modelContext: ModelContext, store: MediaStore) async {
        var progress = loadProgress()
        let targets = targets(modelContext: modelContext, store: store, progress: progress)
        guard !targets.isEmpty else { return }

        // 起動直後はまだ画面が出ておらずアラートを出せないので少し待つ
        try? await Task.sleep(for: .seconds(1))
        guard await confirm("\(targets.count) 件を写真アプリに保存します。") else { return }

        var saved = 0
        var failed = 0
        for media in targets {
            let url = store.url(for: media.fileName)
            do {
                switch media.type {
                case .photo:
                    try await PhotoLibrarySaver.savePhoto(
                        data: try Data(contentsOf: url),
                        takenAt: media.takenAt,
                        coordinate: media.displayCoordinate
                    )
                case .video:
                    try await PhotoLibrarySaver.saveVideo(
                        at: url, takenAt: media.takenAt, coordinate: media.displayCoordinate
                    )
                }
                saved += 1
                // 途中で落ちても続きから流せるよう 1 件ごとに記録する
                progress.doneIDs.insert(media.id.uuidString)
                save(progress)
                print("[backfill] saved \(media.id) \(media.fileName)")
            } catch PhotoLibrarySaver.SaveError.denied {
                // 以降も全部失敗するので中断する
                print("[backfill] denied (\(saved) 件で中断)")
                await notify("写真アプリへの追加が許可されていません。\n設定 > 旅ログ > 写真 を確認してください。")
                return
            } catch {
                failed += 1
                print("[backfill] failed \(media.id): \(error)")
            }
        }
        print("[backfill] done saved=\(saved) failed=\(failed)")
        await notify("\(saved) 件を写真アプリに保存しました(\(failed) 件失敗)")
    }

    // MARK: - 対象

    /// 対象は cutoff より前に撮った未処理のメディア。
    /// cutoff が要るのは、撮影時の自動保存と同じビルドに入るため
    /// (無いと「撮影時に保存 → backfill でもう 1 回保存」で二重になる)
    private static func targets(
        modelContext: ModelContext,
        store: MediaStore,
        progress: Progress
    ) -> [MediaEntity] {
        let descriptor = FetchDescriptor<MediaEntity>(
            predicate: #Predicate<MediaEntity> { $0.deletedAt == nil },
            sortBy: [SortDescriptor(\MediaEntity.takenAt)]
        )
        guard let all = try? modelContext.fetch(descriptor) else { return [] }
        return all.filter { media in
            media.takenAt < progress.cutoff
                && !progress.doneIDs.contains(media.id.uuidString)
                && FileManager.default.fileExists(atPath: store.url(for: media.fileName).path)
        }
    }

    // MARK: - 進捗

    private struct Progress {
        /// この日時より前のメディアだけが対象(以降は撮影時に自動保存されている)。
        /// このビルドを最初に起動した時刻を焼き込む
        var cutoff: Date
        var doneIDs: Set<String>
    }

    private static func loadProgress() -> Progress {
        let stored = UserDefaults.standard.dictionary(forKey: defaultsKey)
        if let cutoff = stored?["cutoff"] as? Double {
            let doneIDs = stored?["doneIDs"] as? [String] ?? []
            return Progress(
                cutoff: Date(timeIntervalSince1970: cutoff), doneIDs: Set(doneIDs)
            )
        }
        let progress = Progress(cutoff: Date(), doneIDs: [])
        save(progress)
        return progress
    }

    private static func save(_ progress: Progress) {
        UserDefaults.standard.set(
            [
                "cutoff": progress.cutoff.timeIntervalSince1970,
                "doneIDs": Array(progress.doneIDs),
            ],
            forKey: defaultsKey
        )
    }

    // MARK: - 確認・報告(一時コードなので UIKit のアラートを直接出す)

    private static func confirm(_ message: String) async -> Bool {
        await withCheckedContinuation { continuation in
            guard let presenter = presenter() else {
                continuation.resume(returning: false)
                return
            }
            let alert = UIAlertController(
                title: "写真アプリへの書き出し", message: message, preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "やめる", style: .cancel) { _ in
                continuation.resume(returning: false)
            })
            alert.addAction(UIAlertAction(title: "実行", style: .default) { _ in
                continuation.resume(returning: true)
            })
            presenter.present(alert, animated: true)
        }
    }

    private static func notify(_ message: String) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            guard let presenter = presenter() else {
                continuation.resume()
                return
            }
            let alert = UIAlertController(
                title: "写真アプリへの書き出し", message: message, preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                continuation.resume()
            })
            presenter.present(alert, animated: true)
        }
    }

    private static func presenter() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .first { $0.activationState == .foregroundActive } as? UIWindowScene
        var controller = scene?.keyWindow?.rootViewController
        while let presented = controller?.presentedViewController {
            controller = presented
        }
        return controller
    }
}
#endif
