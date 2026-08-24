import Foundation

/// メディア自身が持つ撮影位置を読み取るロジック(純関数)。
///
/// GPS 記録の無い旅行や他端末で撮ったメディアは記録点に紐付かないため、
/// 写真の EXIF GPS・動画メタデータの位置を撮影位置として持たせる。
enum MediaCoordinate {
    struct Coordinate: Equatable {
        let latitude: Double
        let longitude: Double
    }

    /// EXIF の GPS 辞書から座標を作る。値は常に正で、南緯・西経は Ref が "S" / "W"。
    static func fromExif(
        latitude: Double?,
        latitudeRef: String?,
        longitude: Double?,
        longitudeRef: String?
    ) -> Coordinate? {
        guard let latitude, let longitude else { return nil }
        return make(
            latitude: latitudeRef?.uppercased() == "S" ? -latitude : latitude,
            longitude: longitudeRef?.uppercased() == "W" ? -longitude : longitude
        )
    }

    /// 動画メタデータの ISO 6709 文字列("+47.6205-122.3493+134.000/")から座標を作る。
    /// 符号付きの数値を順に拾い、先頭 2 つを緯度・経度とする(3 つ目以降は高度など)。
    /// 度分秒表記(+4737.24-12220.96/)は使わない: そのまま度として読むと
    /// 値が範囲外になるため、`make` が nil を返して落ちる。
    static func fromISO6709(_ value: String) -> Coordinate? {
        var numbers: [Double] = []
        var current = ""
        func flush() {
            if let parsed = Double(current) { numbers.append(parsed) }
            current = ""
        }
        for character in value {
            if character == "+" || character == "-" {
                flush()
                current = String(character)
            } else if character.isNumber || character == "." {
                current.append(character)
            } else {
                // "/" 終端や CRS 表記(";crs=...")で区切る
                flush()
            }
        }
        flush()
        guard numbers.count >= 2 else { return nil }
        return make(latitude: numbers[0], longitude: numbers[1])
    }

    private static func make(latitude: Double, longitude: Double) -> Coordinate? {
        guard
            latitude.isFinite, longitude.isFinite,
            abs(latitude) <= 90, abs(longitude) <= 180,
            // 測位できていないメディアに入っている (0, 0) は位置として使わない
            !(latitude == 0 && longitude == 0)
        else { return nil }
        return Coordinate(latitude: latitude, longitude: longitude)
    }
}
