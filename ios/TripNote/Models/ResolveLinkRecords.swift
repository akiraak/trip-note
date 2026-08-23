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
    /// "pin"(ピンの座標)/ "center"(地図の表示中心。ピンとずれることがある)/ nil
    let precision: String?
    let resolvedUrl: String

    var hasCoordinate: Bool { latitude != nil && longitude != nil }
    var isCenterOnly: Bool { precision == "center" }
}

struct ResolveLinkResponse: Decodable {
    let place: ResolvedGoogleMapsPlace
}
