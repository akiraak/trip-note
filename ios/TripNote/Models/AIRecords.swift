import Foundation

/// AI 提案・検索補助(/api/ai/*)のリクエスト/応答 DTO。
/// AI 呼び出しはサーバに集約されており、モデル選択も Web の設定画面で行う
/// (iOS 側に API キーや AI 設定は持たない)。日付フィールドが無いので
/// エンコード/デコードは素の JSONEncoder / JSONDecoder でよい

/// POST /api/ai/plan のリクエスト
struct AIPlanRequest: Encodable {
    let departure: String
    let destination: String
    /// YYYY-MM-DD
    let startDate: String
    let dayCount: Int
    /// Transport.rawValue(未設定なら nil)
    let transport: String?
    /// 自由記述の要望
    let request: String?
}

struct AISuggestedCheckpoint: Decodable, Hashable {
    /// サーバは許可リスト内に寄せて返すが、将来の種別追加に備えて文字列で受ける
    let typeRawValue: String
    let name: String
    let note: String?

    var type: CheckpointType { CheckpointType(rawValue: typeRawValue) ?? .other }

    enum CodingKeys: String, CodingKey {
        case typeRawValue = "type"
        case name
        case note
    }
}

struct AISuggestedDay: Decodable, Hashable {
    /// YYYY-MM-DD
    let date: String
    let title: String
    /// 大まかな地域(検索補助の入力に使える。保存はしない)
    let area: String
    let checkpoints: [AISuggestedCheckpoint]
}

/// POST /api/ai/plan の応答
struct AIPlanSuggestion: Decodable, Hashable {
    let days: [AISuggestedDay]
}

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
}

/// POST /api/ai/search-assist のリクエスト
struct AISearchAssistRequest: Encodable {
    /// 大まかな地域(例: 松本市周辺)
    let area: String
    /// CheckpointType.rawValue の種別ヒント(任意)
    let type: String?
    let request: String?
}

struct AISuggestedPlace: Decodable, Hashable {
    let typeRawValue: String
    let name: String
    let area: String
    let note: String?

    var type: CheckpointType { CheckpointType(rawValue: typeRawValue) ?? .other }

    enum CodingKeys: String, CodingKey {
        case typeRawValue = "type"
        case name
        case area
        case note
    }
}

/// POST /api/ai/search-assist の応答
struct AISearchAssistSuggestion: Decodable, Hashable {
    /// 地図検索にそのまま使えるクエリ候補
    let queries: [String]
    /// 具体的な地点候補
    let places: [AISuggestedPlace]
}
