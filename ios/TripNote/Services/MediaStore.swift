import Foundation

/// メディアファイルの置き場(Application Support/Media/)。
/// ファイル名は MediaEntity.fileName / thumbnailFileName に対応する。
struct MediaStore: Sendable {
    let directory: URL

    static func makeDefault() -> MediaStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return MediaStore(directory: base.appending(path: "Media", directoryHint: .isDirectory))
    }

    func url(for fileName: String) -> URL {
        directory.appending(path: fileName)
    }

    func write(_ data: Data, fileName: String) throws {
        try ensureDirectory()
        try data.write(to: url(for: fileName), options: .atomic)
    }

    /// 一時ファイルをストア内へ移動して取り込む
    func adopt(fileAt sourceURL: URL, fileName: String) throws {
        try ensureDirectory()
        let destination = url(for: fileName)
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: sourceURL, to: destination)
    }

    func ensureDirectory() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
}
