import Foundation

/// AI 提案(/api/ai/*)のリクエスト/応答 DTO。
/// AI 呼び出しはサーバに集約されており、モデル選択も Web の設定画面で行う
/// (iOS 側に API キーや AI 設定は持たない)。日付フィールドが無いので
/// エンコード/デコードは素の JSONEncoder / JSONDecoder でよい

/// POST /api/ai/trip-outline のリクエスト。
/// 出発日時はタイムゾーン変換を避けるため端末ローカルの日付と時刻に分けて送る
struct AITripOutlineRequest: Encodable {
    let destination: String
    /// YYYY-MM-DD(ローカル日付)
    let departureDate: String
    /// HH:mm(ローカル時刻)
    let departureTime: String
    /// 出発地(任意。1 日目の departure チェックポイント名)
    let departure: String?
    /// 出発地の座標(任意。現在地から設定した場合。地名が番地でも位置を特定できる)
    let departureLatitude: Double?
    let departureLongitude: Double?
    /// Transport.rawValue(未設定なら nil)
    let transport: String?
    /// 自由記述の要望
    let request: String?
}

/// 1 泊分の宿泊地候補
struct AISuggestedNight: Decodable, Hashable {
    /// 大まかな地域(例: 松本市街)
    let area: String
    /// 宿の候補または「◯◯周辺の宿」のような検索しやすい表現
    let name: String
    let note: String?
    /// 地域の概算座標(候補プレビュー地図専用。チェックポイントには保存しない)
    let latitude: Double?
    let longitude: Double?
}

/// 日数と宿泊地の候補 1 件(例: 2泊3日 + 各泊の宿泊地)
struct AITripOutlineCandidate: Decodable, Hashable {
    let dayCount: Int
    /// 例: 「2泊3日でゆったり」
    let title: String
    /// 泊数分(通常 dayCount - 1)。n 番目 = n+1 泊目
    let nights: [AISuggestedNight]
}

/// POST /api/ai/trip-outline の応答
struct AITripOutlineSuggestion: Decodable, Hashable {
    let candidates: [AITripOutlineCandidate]
    /// 目的地の概算座標(候補共通。採用時に最終日の destination チェックポイントへ入れる)
    let destinationLatitude: Double?
    let destinationLongitude: Double?
}

// ---- 生成ジョブ (/api/ai/jobs) ----
// trip-outline の生成は数十秒〜数分かかり、接続を張りっぱなしにすると
// アプリ切替で iOS がソケットを切ってしまう。そのためジョブ登録 → ポーリングで
// 結果を受け取る

/// POST /api/ai/jobs のリクエスト。id はクライアント発行の UUID(再送冪等)
struct AIJobCreateRequest<Input: Encodable>: Encodable {
    let id: String
    /// "trip_outline"
    let kind: String
    let input: Input
}

/// POST /api/ai/jobs の応答(登録直後の状態)
struct AIJobCreated: Decodable {
    let id: String
    let status: String
}

/// GET /api/ai/jobs/[id] の応答。status が succeeded なら result、
/// failed なら error が入る(pending / running では両方 nil)
struct AIJobStatusResponse<Output: Decodable>: Decodable {
    let id: String
    let status: String
    let result: Output?
    let error: String?
}
