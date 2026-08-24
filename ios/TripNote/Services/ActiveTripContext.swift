import Observation
import SwiftUI

/// いま開いている旅行(旅行画面・日詳細)を保持する。
/// 記録バーが「どの旅行に対して撮影・記録するか」を決めるのに使う。
@MainActor
@Observable
final class ActiveTripContext {
    private(set) var trip: TripEntity?
    /// 開いている画面の識別子。旅行画面 → 日詳細の遷移では
    /// onDisappear / onAppear の順序が保証されないため、
    /// 自分が入れた分だけを消せるように鍵を持つ
    private var token: UUID?

    func open(_ trip: TripEntity?, token: UUID) {
        guard let trip else { return }
        self.trip = trip
        self.token = token
    }

    func close(token: UUID) {
        guard self.token == token else { return }
        trip = nil
        self.token = nil
    }
}

extension View {
    /// この画面が出ている間、記録バーの対象をこの旅行にする
    func activeTrip(_ trip: TripEntity?) -> some View {
        modifier(ActiveTripModifier(trip: trip))
    }
}

private struct ActiveTripModifier: ViewModifier {
    let trip: TripEntity?

    @Environment(ActiveTripContext.self) private var context
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .onAppear { context.open(trip, token: token) }
            .onDisappear { context.close(token: token) }
    }
}
