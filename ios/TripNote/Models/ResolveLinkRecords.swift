import Foundation

/// POST /api/places/resolve-link のリクエスト。共有テキスト(場所名 + URL)でも URL 単体でもよい
struct ResolveLinkRequest: Encodable {
    let link: String
}

/// Google Maps の共有リンクから取り出した場所。座標が取れなければ name だけのこともある
struct ResolvedGoogleMapsPlace: Decodable, Hashable {
    let name: String?
    let latitude: Double?
    let longitude: Double?
    /// "pin"(ピンの座標)/ "center"(地図の表示中心)/ "geocoded"(名前 + 住所から推定)/
    /// "area"(住所の町丁目までのおおよその位置)/ nil(座標なし)
    let precision: String?
    let resolvedUrl: String
    /// geocoded / area のとき、推定に使った文字列
    let geocodedQuery: String?

    var hasCoordinate: Bool { latitude != nil && longitude != nil }

    /// ピンの座標ではないときの注記(UI にそのまま出す)。ピン・座標なしは nil
    var approximationNote: String? {
        switch precision {
        case "center":
            return "リンクの地図の中心の位置です(ピンとずれることがあります)"
        case "geocoded":
            return "住所から推定した位置です(\(geocodedQuery ?? "")。ピンとずれることがあります)"
        case "area":
            return "住所「\(geocodedQuery ?? "")」のおおよその位置です。編集で Google Maps のリンクを貼り直すと直せます"
        default:
            return nil
        }
    }
}

struct ResolveLinkResponse: Decodable {
    let place: ResolvedGoogleMapsPlace
}
