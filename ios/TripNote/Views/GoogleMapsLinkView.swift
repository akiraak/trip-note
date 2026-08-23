import SwiftUI

/// Google Maps のリンクから取り出した地点(チェックポイントに入れる値)。
/// 座標が取れないリンク(名前だけ)もあるので座標は optional
struct PlaceSelection: Identifiable {
    let id = UUID()
    let name: String
    let latitude: Double?
    let longitude: Double?
    /// リンクからは種別が分からないので常に sightseeing(編集フォームで変更できる)
    let suggestedType: CheckpointType = .sightseeing
}

/// Google Maps のリンク(共有テキストごと貼ってもよい)を貼って場所を 1 件取り込む画面。
/// 展開とパースはサーバ(POST /api/places/resolve-link)で行う。
/// 選択すると onSelect を呼んで閉じる
struct GoogleMapsLinkView: View {
    /// 座標が取れなかった結果も選べるか(日詳細の「追加」だけ true)
    var allowsMissingCoordinate: Bool = false
    let onSelect: (PlaceSelection) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var result: ResolvedGoogleMapsPlace?
    @State private var isResolving = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("Google Maps のリンクを貼る", text: $link, axis: .vertical)
                            .lineLimit(1...4)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .onSubmit { Task { await resolve() } }
                        if isResolving {
                            ProgressView()
                        }
                    }
                    Button("読み込む") {
                        Task { await resolve() }
                    }
                    .disabled(isResolving || trimmedLink.isEmpty)
                } footer: {
                    Text("Google Maps で場所を開き「共有」→「リンクをコピー」したものを貼ると、その場所を追加できます。Google Maps の共有シートから直接「旅ログ」を選ぶこともできます。")
                }
                Section {
                    if let message {
                        Text(message)
                            .foregroundStyle(.secondary)
                    }
                    if let result {
                        resultRow(result)
                    }
                }
            }
            .navigationTitle("Google Maps のリンクから追加")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func resultRow(_ place: ResolvedGoogleMapsPlace) -> some View {
        let canSelect = place.hasCoordinate || allowsMissingCoordinate
        let row = VStack(alignment: .leading, spacing: 2) {
            Text(linkName(place))
            Text(detail(place))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        if canSelect {
            Button {
                select(place)
            } label: {
                row
            }
            .buttonStyle(.plain)
        } else {
            row
        }
    }

    private func detail(_ place: ResolvedGoogleMapsPlace) -> String {
        if place.hasCoordinate {
            return place.approximationNote.map { "Google Maps のリンク: \($0)" }
                ?? "Google Maps のリンク(ピンの位置)"
        }
        return allowsMissingCoordinate
            ? "座標が取れませんでした(座標未設定のまま追加できます)"
            : "座標が取れませんでした(位置を設定できません)"
    }

    private var trimmedLink: String {
        link.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 入力に Google Maps の URL があればサーバで展開する。無ければ何もしない
    private func resolve() async {
        let trimmed = trimmedLink
        guard !trimmed.isEmpty, !isResolving else { return }
        message = nil
        guard GoogleMapsShare.extractURL(from: trimmed) != nil else {
            result = nil
            message = "Google Maps のリンクを貼ってください"
            return
        }
        guard let client = SyncClient.fromBundle() else {
            message = "サーバが未設定のためリンクを解決できません(ServerConfig.plist を確認してください)"
            return
        }
        result = nil
        isResolving = true
        defer { isResolving = false }
        do {
            result = try await client.resolveGoogleMapsLink(trimmed)
        } catch {
            result = nil
            message = "リンクを解決できませんでした: \(error.localizedDescription)"
        }
    }

    private func linkName(_ place: ResolvedGoogleMapsPlace) -> String {
        if let name = place.name, !name.isEmpty { return name }
        return GoogleMapsShare.nameHint(from: link) ?? "Google Maps の場所"
    }

    private func select(_ place: ResolvedGoogleMapsPlace) {
        onSelect(
            PlaceSelection(
                name: linkName(place),
                latitude: place.latitude,
                longitude: place.longitude
            )
        )
        dismiss()
    }
}
