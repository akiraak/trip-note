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

    /// 暗い地図・パネルの上で読める彩度に寄せた種別色
    /// (Web 側 web/src/lib/checkpoint-style.ts の CHECKPOINT_COLORS と同じ値)
    var tint: Color {
        switch self {
        case .departure: Theme.done
        case .destination: Theme.danger
        case .sightseeing: Color(hex: 0xF2A0_3D)
        case .cafe: Color(hex: 0xC99B_6A)
        case .restaurant: Color(hex: 0xF274_A6)
        case .lodging: Color(hex: 0x8CA0_FF)
        case .other: Theme.muted
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
