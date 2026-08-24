import SwiftUI

/// ボトムシートの高さの段階
enum SheetDetent: CaseIterable {
    /// 地図をいちばん広く見る(見出しと統計だけ見える)
    case collapsed
    /// 地図と行程を半々に見る
    case medium
    /// 行程を読む
    case expanded

    func height(in total: CGFloat) -> CGFloat {
        switch self {
        case .collapsed: min(196, total * 0.34)
        case .medium: total * 0.55
        case .expanded: total * 0.92
        }
    }
}

/// 地図の上に重ねるボトムシート。
/// SwiftUI の .sheet を使わない理由: シートの中から NavigationLink で日詳細へ進みたいので、
/// 同じ NavigationStack の中に居る必要がある(.sheet は別の階層になる)。
/// つまみ(グラブバーと見出し)のドラッグで 3 段階にスナップし、中身のスクロールとは競合させない
struct RouteSheet<Content: View>: View {
    @Binding var detent: SheetDetent
    /// つまみの下に置く中身(スクロールするものを想定)
    @ViewBuilder var content: Content

    @State private var dragOffset: CGFloat = 0

    var body: some View {
        GeometryReader { proxy in
            let total = proxy.size.height
            // 上方向のドラッグ(負の translation)で高くなる
            let height = min(max(detent.height(in: total) - dragOffset, 96), total)
            VStack(spacing: 0) {
                grabber
                    .gesture(drag(in: total))
                    .onTapGesture {
                        withAnimation(.snappy(duration: 0.28)) {
                            detent = detent == .expanded ? .medium : .expanded
                        }
                    }
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .frame(height: height, alignment: .top)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .background(
                UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20)
                    .fill(Theme.panel)
                    .overlay(
                        UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20)
                            .stroke(Theme.line, lineWidth: 1)
                    )
                    .frame(height: height)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .shadow(color: .black.opacity(0.45), radius: 18, y: -8)
            )
        }
        .ignoresSafeArea(edges: .bottom)
    }

    /// つまみ。細い線だけだと掴みにくいので、上下に余白を取った帯全体を当たり判定にする
    private var grabber: some View {
        Capsule()
            .fill(Theme.line)
            .frame(width: 40, height: 5)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
    }

    private func drag(in total: CGFloat) -> some Gesture {
        DragGesture()
            .onChanged { value in
                dragOffset = value.translation.height
            }
            .onEnded { value in
                // 指を離した位置に近い段にスナップする(勢いも少しだけ足す)
                let released = detent.height(in: total)
                    - value.translation.height
                    - value.predictedEndTranslation.height * 0.2
                let nearest = SheetDetent.allCases.min {
                    abs($0.height(in: total) - released)
                        < abs($1.height(in: total) - released)
                } ?? detent
                withAnimation(.snappy(duration: 0.28)) {
                    dragOffset = 0
                    detent = nearest
                }
            }
    }
}

/// シートの中で使う一覧。行の背景・区切りをパネル色に合わせた List
struct SheetList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        List {
            content
                .listRowBackground(Theme.panel)
                .listRowSeparatorTint(Theme.line)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.panel)
        .environment(\.defaultMinListRowHeight, 0)
        // ホームインジケータに最後の行が重ならないようにする
        .safeAreaPadding(.bottom, 28)
    }
}
