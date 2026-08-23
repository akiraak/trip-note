import Foundation

/// 検索欄の入力が「観光地」のようなカテゴリ語なら、地名検索(MapKit)ではなく
/// その日の経路の近くをサーバ(/api/places/nearby)でカテゴリ検索する。判定表はここだけ。
/// Web 側 web/src/lib/category-search.ts と揃える
enum SearchCategory: String, CaseIterable {
    case sightseeing

    var label: String {
        switch self {
        case .sightseeing: return "観光地"
        }
    }

    /// 結果をチェックポイントにするときの種別
    var checkpointType: CheckpointType {
        switch self {
        case .sightseeing: return .sightseeing
        }
    }

    private var keywords: [String] {
        switch self {
        case .sightseeing: return ["観光地", "観光", "観光スポット", "名所"]
        }
    }

    /// 入力(trim 後の完全一致)がカテゴリ語ならそのカテゴリ、違えば nil
    static func match(_ query: String) -> SearchCategory? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return allCases.first { $0.keywords.contains(trimmed) }
    }
}
