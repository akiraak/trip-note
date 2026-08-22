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
