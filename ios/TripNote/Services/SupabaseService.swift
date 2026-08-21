import Foundation
import Observation
import Supabase

/// Supabase クライアントと認証状態を保持するサービス。
/// 接続情報は `Resources/Supabase.plist`(gitignore 済み)から読む。
/// plist が無い・雛形のままの場合は `client == nil` となり、同期機能だけが無効になる。
@MainActor
@Observable
final class SupabaseService {
    enum SignUpResult {
        case signedIn
        case needsEmailConfirmation
        case failed
    }

    let client: SupabaseClient?
    private(set) var session: Session?
    private(set) var lastAuthError: String?

    var isConfigured: Bool { client != nil }
    var isSignedIn: Bool { session != nil }
    var userEmail: String? { session?.user.email }

    init() {
        client = Self.makeClient()
        if client != nil {
            // .initialSession で Keychain に保存済みのセッションが復元される
            Task { await observeAuthChanges() }
        }
    }

    func signIn(email: String, password: String) async -> Bool {
        guard let client else { return false }
        do {
            try await client.auth.signIn(email: email, password: password)
            lastAuthError = nil
            return true
        } catch {
            lastAuthError = "ログインに失敗しました: \(error.localizedDescription)"
            return false
        }
    }

    func signUp(email: String, password: String) async -> SignUpResult {
        guard let client else { return .failed }
        do {
            let response = try await client.auth.signUp(email: email, password: password)
            lastAuthError = nil
            // メール確認が有効な場合は session が返らない
            return response.session != nil ? .signedIn : .needsEmailConfirmation
        } catch {
            lastAuthError = "登録に失敗しました: \(error.localizedDescription)"
            return .failed
        }
    }

    func signOut() async {
        guard let client else { return }
        do {
            try await client.auth.signOut()
            lastAuthError = nil
        } catch {
            lastAuthError = "ログアウトに失敗しました: \(error.localizedDescription)"
        }
    }

    private func observeAuthChanges() async {
        guard let client else { return }
        for await (_, session) in client.auth.authStateChanges {
            self.session = session
        }
    }

    private static func makeClient() -> SupabaseClient? {
        guard
            let url = Bundle.main.url(forResource: "Supabase", withExtension: "plist"),
            let data = try? Data(contentsOf: url),
            let plist = try? PropertyListSerialization.propertyList(from: data, format: nil),
            let dict = plist as? [String: Any],
            let urlString = dict["SUPABASE_URL"] as? String,
            let anonKey = dict["SUPABASE_ANON_KEY"] as? String,
            let supabaseURL = URL(string: urlString),
            !urlString.contains("xxxxxxxx"),
            !anonKey.isEmpty
        else { return nil }
        return SupabaseClient(supabaseURL: supabaseURL, supabaseKey: anonKey)
    }
}
