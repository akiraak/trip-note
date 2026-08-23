import Foundation

/// Share Extension が受け取った共有(Google Maps の場所など)。本体が取り込んだら消す
struct PendingShare: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    /// 共有テキスト(「松本城\nhttps://maps.app.goo.gl/…」)。URL のみの共有なら nil
    var text: String?
    /// 共有された URL(public.url)。テキストのみの共有なら nil
    var url: String?
    var receivedAt: Date = Date()

    /// 取り込みに使う文字列(テキスト優先。名前のヒントが入っているため)
    var link: String? {
        if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return text
        }
        return url
    }
}

/// Share Extension → 本体の受け渡し箱。App Group の UserDefaults に Codable 配列で置く。
/// Extension は SwiftData・サーバ設定に触らず、ここに入れて本体を開くだけにする
struct ShareInbox {
    static let appGroupID = "group.com.akiraak.TripNote"
    static let key = "pendingShares"
    /// 本体を開くための URL(project.yml の CFBundleURLTypes)
    static let openURL = URL(string: "tripnote://share")!

    let defaults: UserDefaults

    /// App Group の箱。entitlement が無い環境では suite が作れず standard に落ちる
    static var shared: ShareInbox {
        ShareInbox(defaults: UserDefaults(suiteName: appGroupID) ?? .standard)
    }

    func pending() -> [PendingShare] {
        guard let data = defaults.data(forKey: Self.key) else { return [] }
        return (try? JSONDecoder().decode([PendingShare].self, from: data)) ?? []
    }

    func append(_ share: PendingShare) {
        save(pending() + [share])
    }

    func remove(id: UUID) {
        save(pending().filter { $0.id != id })
    }

    func removeAll() {
        defaults.removeObject(forKey: Self.key)
    }

    private func save(_ shares: [PendingShare]) {
        if shares.isEmpty {
            defaults.removeObject(forKey: Self.key)
            return
        }
        if let data = try? JSONEncoder().encode(shares) {
            defaults.set(data, forKey: Self.key)
        }
    }
}
