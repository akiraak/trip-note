import PhotosUI
import SwiftUI
import UIKit

/// 画面下に常駐する記録バー(音楽アプリのミニプレイヤー相当)。
/// 移動中の肝である「記録の状況」と「撮影・記録の開始/停止」を、
/// どの画面からでも 1 タップで扱えるようにする。
struct RecordingBar: View {
    /// バー本体の高さ
    static let height: CGFloat = 60
    /// バーと画面下端(セーフエリア)の間の余白
    static let bottomGap: CGFloat = 8
    /// バーが浮いているぶん、下端まで中身がある画面が足すべき余白
    static var inset: CGFloat { height + bottomGap + 8 }

    let content: RecordingBarState.Content
    /// カメラの無い環境(シミュレータ)で撮影ボタンの代わりに出す PhotosPicker の選択
    @Binding var pickerItems: [PhotosPickerItem]
    var onOpenTrip: () -> Void
    var onCamera: () -> Void
    var onStart: () -> Void
    var onStop: () -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 8) {
            Button(action: tapText) {
                textArea
            }
            .buttonStyle(.plain)
            captureButton
            recordButton
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .frame(height: Self.height)
        // シート(Theme.panel)の上に浮くので、一段持ち上げた色で面を分ける
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(content.isRecording ? Theme.done.opacity(0.55) : Theme.line, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.45), radius: 14, y: 4)
        .padding(.horizontal, 12)
        .padding(.bottom, Self.bottomGap)
        .accessibilityIdentifier("recording-bar")
    }

    // MARK: - 左(状況)

    private var textArea: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 7) {
                Circle()
                    .fill(content.isRecording ? Theme.done : Theme.muted)
                    .frame(width: 7, height: 7)
                Text(content.trip.title)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
            }
            detailLine
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var detailLine: some View {
        switch content.detail {
        case .recording(let pointCount, let distanceMeters):
            HStack(spacing: 5) {
                Text("記録中")
                    .foregroundStyle(Theme.done)
                if let startedAt = content.startedAt {
                    // 秒まで出すと再描画が増えるだけなので分単位で更新する
                    TimelineView(.periodic(from: .now, by: 60)) { timeline in
                        Text(RecordingBarState.elapsedText(from: startedAt, to: timeline.date) ?? "")
                    }
                }
                separator
                Text(RecordingBarState.pointCountText(pointCount))
                separator
                Text(RecordingBarState.distanceText(distanceMeters))
            }
            .font(Theme.numeric(.caption))
            .foregroundStyle(Theme.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        case .idle:
            Text(RecordingBarState.idleText)
                .font(.caption)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
        case .importing:
            HStack(spacing: 6) {
                ProgressView()
                    .controlSize(.mini)
                    .tint(Theme.muted)
                Text(RecordingBarState.importingText)
            }
            .font(.caption)
            .foregroundStyle(Theme.muted)
            .lineLimit(1)
        case .error(let message, let showsSettings):
            Text(showsSettings ? "\(message)(タップで設定)" : message)
                .font(.caption)
                .foregroundStyle(Theme.danger)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private var separator: some View {
        Text("·")
            .foregroundStyle(Theme.line)
            .accessibilityHidden(true)
    }

    // MARK: - 右(操作)

    @ViewBuilder
    private var captureButton: some View {
        if CameraPicker.isAvailable {
            barButton(systemImage: "camera.fill", tint: Theme.ink, label: "写真・動画を撮影", action: onCamera)
        } else {
            // カメラの無い環境(シミュレータ)はライブラリから選ぶ動線に差し替える
            PhotosPicker(selection: $pickerItems, matching: .any(of: [.images, .videos])) {
                BarIcon(systemImage: "photo.badge.plus", tint: Theme.ink)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("写真・動画を追加")
        }
    }

    @ViewBuilder
    private var recordButton: some View {
        if content.isRecording {
            barButton(systemImage: "stop.fill", tint: Theme.danger, label: "記録を停止", action: onStop)
        } else {
            barButton(systemImage: "record.circle", tint: Theme.done, label: "記録を開始", action: onStart)
        }
    }

    private func barButton(
        systemImage: String,
        tint: Color,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            BarIcon(systemImage: systemImage, tint: tint)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    /// 左のタップ。権限エラーのときだけ設定アプリへ、それ以外は旅行の画面へ
    private func tapText() {
        if case .error(_, showsSettings: true) = content.detail,
           let url = URL(string: UIApplication.openSettingsURLString) {
            openURL(url)
            return
        }
        onOpenTrip()
    }
}

/// バーの右に並ぶ操作の見た目(撮影・記録)。
/// PhotosPicker のラベルからも使うため View 型で持つ
private struct BarIcon: View {
    let systemImage: String
    let tint: Color

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: 40, height: 40)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
    }
}

/// 記録バーが浮いているぶん、下端まで中身がある画面が足す余白。
/// バーの表示・非表示に合わせて ContentView が配る
private struct RecordingBarInsetKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    var recordingBarInset: CGFloat {
        get { self[RecordingBarInsetKey.self] }
        set { self[RecordingBarInsetKey.self] = newValue }
    }
}
