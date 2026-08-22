import SwiftUI

/// チェックポイント種別の表示定義。リスト行と地図ピンで共通に使う
extension CheckpointType {
    var label: String {
        switch self {
        case .departure: "出発地"
        case .destination: "到着予定地"
        case .sightseeing: "観光"
        case .cafe: "カフェ"
        case .restaurant: "食事"
        case .lodging: "宿泊"
        case .other: "その他"
        }
    }

    var systemImage: String {
        switch self {
        case .departure: "flag.fill"
        case .destination: "flag.checkered"
        case .sightseeing: "binoculars.fill"
        case .cafe: "cup.and.saucer.fill"
        case .restaurant: "fork.knife"
        case .lodging: "bed.double.fill"
        case .other: "mappin"
        }
    }

    var tint: Color {
        switch self {
        case .departure: .green
        case .destination: .red
        case .sightseeing: .orange
        case .cafe: .brown
        case .restaurant: .pink
        case .lodging: .indigo
        case .other: .gray
        }
    }
}

extension Transport {
    var label: String {
        switch self {
        case .car: "車"
        case .train: "電車"
        case .walk: "徒歩"
        case .bicycle: "自転車"
        case .mixed: "混合"
        }
    }
}
