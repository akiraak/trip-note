import Foundation

/// 共有で受け取った場所をどの旅行・どの日に入れるかの既定値(取り込みシートの初期選択)
enum SharedPlaceImport {
    /// 既定の旅行 = 一覧の先頭(未出発(プラン中)→ 出発日時の新しい順 = ContentView の並び)
    static func defaultTrip(in trips: [TripEntity]) -> TripEntity? {
        trips.first
    }

    /// 既定の日: 旅行が進行中で今日が日程にあれば今日、それ以外は最初の日。日が無ければ nil
    static func defaultDay(in trip: TripEntity, today: String) -> TripDayEntity? {
        let days = trip.sortedDays
        if trip.status == .inProgress, let todayEntry = days.first(where: { $0.date == today }) {
            return todayEntry
        }
        return days.first
    }

    /// 取り込みシートに出す名前。サーバの結果 → 共有テキストの 1 行目 → 空
    static func placeName(resolved: ResolvedGoogleMapsPlace?, share: PendingShare) -> String {
        if let name = resolved?.name, !name.isEmpty { return name }
        if let text = share.text, let hint = GoogleMapsShare.nameHint(from: text) { return hint }
        return ""
    }
}
