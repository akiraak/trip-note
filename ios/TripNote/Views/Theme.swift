import SwiftUI

/// 案 C「ルートキャンバス」のデザイントークン(docs/plans/design-refresh.md)。
/// アプリはダーク固定なので、OS の外観に関わらずこの 1 セットだけを使う。
/// Web 側(web/src/app/globals.css)と同じ値を持たせること
enum Theme {
    /// 地図の下に敷く一番暗い面(画面の地)
    static let canvas = Color(hex: 0x1014_19)
    /// シート・カードの面
    static let panel = Color(hex: 0x1A22_2B)
    /// 面の上でさらに一段持ち上げる場所(選択中の日・チップ)
    static let raised = Color(hex: 0x222C_36)
    static let line = Color(hex: 0x2C37_43)
    static let ink = Color(hex: 0xE9ED_F2)
    static let muted = Color(hex: 0x93A0_AE)
    /// これからのルート・操作色
    static let accent = Color(hex: 0x5AA9_E6)
    /// 記録済みのルート・進行中
    static let done = Color(hex: 0x7BD3_89)
    /// 削除など後戻りできない操作
    static let danger = Color(hex: 0xFF7C_6B)

    /// 距離・時刻・座標など、桁をそろえて読む数値
    static func numeric(_ style: Font.TextStyle) -> Font {
        .system(style, design: .monospaced)
    }
}

extension Color {
    /// 0xRRGGBB のリテラルから作る(トークン定義専用)
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// 状態を色と一言で表すタグ(記録中 / 進行中 / プラン中)
struct StatusTag: View {
    let label: String
    let color: Color

    var body: some View {
        Text(label)
            .font(Theme.numeric(.caption2))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(color.opacity(0.16), in: Capsule())
    }
}

/// 地図の上に浮かせる丸いアイコンボタン
struct MapCircleButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 36, height: 36)
                .background(Theme.panel.opacity(0.9), in: Circle())
                .overlay(Circle().stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// 地図の上に浮かせるラベル付きチップ(距離・状態・操作)
struct MapChip: View {
    let text: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .medium))
            }
            Text(text)
                .font(Theme.numeric(.caption2))
        }
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 9))
        .overlay(
            RoundedRectangle(cornerRadius: 9).stroke(Theme.line, lineWidth: 1)
        )
    }
}

/// シート・パネル内の見出し(セクションラベル)
struct PanelLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.numeric(.caption2))
            .tracking(1.6)
            .foregroundStyle(Theme.muted)
    }
}

/// 統計の 1 項目(ラベル + 値)。シートの上部に横並びで置く
struct StatCell: View {
    let label: String
    let value: String
    var valueColor: Color = Theme.ink
    /// 目的地など、桁をそろえる意味がない値は通常の書体で出す
    var isNumeric = true

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(Theme.numeric(.caption2))
                .tracking(1.1)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
            Text(value)
                .font(isNumeric ? Theme.numeric(.subheadline) : .subheadline)
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
