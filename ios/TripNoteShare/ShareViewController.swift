import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// 共有シートの「旅ログ」。Google Maps の共有(場所名 + 短縮リンク)を App Group の
/// 受信箱(ShareInbox)に入れて本体を開くだけで、SwiftData・サーバには触らない
/// (取り込み先の旅行 / 日の選択と追加は本体の SharedPlaceImportView が行う)
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let host = UIHostingController(
            rootView: ShareSheetView(
                load: { [weak self] in await self?.loadShare() ?? .failure(.noContent) },
                openApp: { [weak self] in self?.openHostApp() ?? false },
                close: { [weak self] in self?.finish() }
            )
        )
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    enum ShareError: Error {
        case noContent
        case notGoogleMaps
    }

    /// 共有された URL / テキストを集めて受信箱に入れる
    private func loadShare() async -> Result<PendingShare, ShareError> {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var text: String?
        var url: String?
        for item in items {
            for provider in item.attachments ?? [] {
                if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    url = await loadURL(from: provider)?.absoluteString
                }
                if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    text = await loadText(from: provider)
                }
            }
        }
        if text == nil, url == nil {
            return .failure(.noContent)
        }
        let candidates = [text, url].compactMap { $0 }
        guard candidates.contains(where: { GoogleMapsShare.extractURL(from: $0) != nil }) else {
            return .failure(.notGoogleMaps)
        }
        let share = PendingShare(text: text, url: url)
        ShareInbox.shared.append(share)
        return .success(share)
    }

    private func loadURL(from provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                if let url = item as? URL {
                    continuation.resume(returning: url)
                } else if let data = item as? Data, let url = URL(dataRepresentation: data, relativeTo: nil) {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private func loadText(from provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                if let text = item as? String {
                    continuation.resume(returning: text)
                } else if let data = item as? Data {
                    continuation.resume(returning: String(data: data, encoding: .utf8))
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    /// 本体(tripnote://share)を開く。Extension からホストアプリを開く公式 API は無いので、
    /// レスポンダチェーンをたどって UIApplication の openURL: を呼ぶ既知の回避策を使う
    @objc private func openURL(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                return application.perform(#selector(openURL(_:)), with: url) != nil
            }
            responder = current.next
        }
        return false
    }

    private func openHostApp() -> Bool {
        let url = ShareInbox.openURL
        if openURL(url) {
            finish()
            return true
        }
        // 念のため extensionContext 経由も試す(機種・OS によっては効く)
        extensionContext?.open(url) { [weak self] success in
            if success { self?.finish() }
        }
        return false
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}

/// Extension の画面。受け取り結果と「旅ログを開く」だけの最小 UI
private struct ShareSheetView: View {
    let load: () async -> Result<PendingShare, ShareViewController.ShareError>
    let openApp: () -> Bool
    let close: () -> Void

    @State private var result: Result<PendingShare, ShareViewController.ShareError>?
    @State private var openFailed = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                switch result {
                case nil:
                    ProgressView("受け取り中…")
                case .success(let share):
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(.green)
                    Text("旅ログに送りました")
                        .font(.headline)
                    if let text = share.text, let name = GoogleMapsShare.nameHint(from: text) {
                        Text(name)
                            .foregroundStyle(.secondary)
                    }
                    if openFailed {
                        Text("旅ログを開くと、この場所の追加先を選べます")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    } else {
                        Button {
                            if !openApp() { openFailed = true }
                        } label: {
                            Text("旅ログを開く")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                case .failure(let error):
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(.orange)
                    Text(
                        error == .notGoogleMaps
                            ? "Google Maps のリンクが見つかりません"
                            : "共有された内容を読み取れませんでした"
                    )
                    .font(.headline)
                    Text("Google Maps で場所を開き、「共有」から旅ログを選んでください")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("旅ログ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("閉じる", action: close)
                }
            }
            .task {
                result = await load()
            }
        }
    }
}
