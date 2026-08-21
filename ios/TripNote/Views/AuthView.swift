import SwiftUI

/// メール + パスワードでのログイン / 新規登録画面。
struct AuthView: View {
    @Environment(SupabaseService.self) private var supabase
    @Environment(SyncEngine.self) private var sync
    @Environment(\.dismiss) private var dismiss

    private enum Mode: Hashable {
        case signIn
        case signUp
    }

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var infoMessage: String?

    var body: some View {
        Form {
            Picker("モード", selection: $mode) {
                Text("ログイン").tag(Mode.signIn)
                Text("新規登録").tag(Mode.signUp)
            }
            .pickerStyle(.segmented)

            Section {
                TextField("メールアドレス", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("パスワード", text: $password)
                    .textContentType(mode == .signUp ? .newPassword : .password)
            }

            Section {
                Button(mode == .signIn ? "ログイン" : "登録する") {
                    submit()
                }
                .disabled(isWorking || email.isEmpty || password.isEmpty)
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    if isWorking {
                        ProgressView()
                    }
                    if let error = supabase.lastAuthError {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                    if let info = infoMessage {
                        Text(info)
                    }
                }
            }
        }
        .navigationTitle(mode == .signIn ? "ログイン" : "新規登録")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        isWorking = true
        infoMessage = nil
        Task {
            defer { isWorking = false }
            switch mode {
            case .signIn:
                if await supabase.signIn(email: email, password: password) {
                    dismiss()
                    await sync.syncNow()
                }
            case .signUp:
                switch await supabase.signUp(email: email, password: password) {
                case .signedIn:
                    dismiss()
                    await sync.syncNow()
                case .needsEmailConfirmation:
                    infoMessage = "確認メールを送信しました。メール内のリンクを開いてからログインしてください。"
                case .failed:
                    break
                }
            }
        }
    }
}
