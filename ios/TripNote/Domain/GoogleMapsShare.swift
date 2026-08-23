import Foundation

/// Google Maps の共有(共有シート経由・リンク貼り付け)で渡ってくるテキストの扱い。
/// Google Maps アプリの共有は「松本城\nhttps://maps.app.goo.gl/XXXX」のように
/// 1 行目が場所名、URL が短縮リンク。座標は短縮リンクの展開先にしか無いので
/// 解決はサーバ(POST /api/places/resolve-link)に任せ、ここでは URL の抜き出しと
/// 名前のヒントだけを純関数で持つ(Share Extension と本体の両方で使う)
enum GoogleMapsShare {
    /// 共有リンクとして受け付けるホスト(サーバ側 lib/google-maps-share.ts と同じ表)
    static let hosts: Set<String> = [
        "maps.app.goo.gl",
        "goo.gl",
        "share.google",
        "maps.google.com",
        "www.google.com",
        "google.com",
        "maps.google.co.jp",
        "www.google.co.jp",
        "google.co.jp",
    ]

    static func isGoogleMapsURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host()?.lowercased()
        else { return false }
        return hosts.contains(host)
    }

    /// テキストから Google Maps の URL を 1 つ取り出す(URL 単体でも可)。無ければ nil
    static func extractURL(from text: String) -> URL? {
        // URL に使える ASCII だけを取る(Google の URL は日本語もパーセント符号化済み)。
        // 括弧・引用符は本文側の記号とみなして含めない
        let pattern = #"https?://[A-Za-z0-9\-._~:/?#\[\]@!$&*+,;=%]+"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        for match in regex.matches(in: text, range: range) {
            guard let matchRange = Range(match.range, in: text) else { continue }
            var candidate = String(text[matchRange])
            while let last = candidate.last, ".,;:!?".contains(last) {
                candidate.removeLast()
            }
            if let url = URL(string: candidate), isGoogleMapsURL(url) {
                return url
            }
        }
        return nil
    }

    /// 共有テキストの中の場所名(URL を含まない最初の行)。無ければ nil
    static func nameHint(from text: String) -> String? {
        for line in text.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.contains("://") { continue }
            return trimmed
        }
        return nil
    }
}
