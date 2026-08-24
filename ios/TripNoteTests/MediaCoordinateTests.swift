import Foundation
import Testing
@testable import TripNote

struct MediaCoordinateTests {
    @Test func EXIFの南緯西経はRefで符号を付ける() {
        #expect(
            MediaCoordinate.fromExif(
                latitude: 47.6205, latitudeRef: "N", longitude: 122.3493, longitudeRef: "W"
            ) == MediaCoordinate.Coordinate(latitude: 47.6205, longitude: -122.3493)
        )
        #expect(
            MediaCoordinate.fromExif(
                latitude: 33.8688, latitudeRef: "S", longitude: 151.2093, longitudeRef: "E"
            ) == MediaCoordinate.Coordinate(latitude: -33.8688, longitude: 151.2093)
        )
    }

    @Test func EXIFに座標が無ければnil() {
        #expect(
            MediaCoordinate.fromExif(
                latitude: nil, latitudeRef: "N", longitude: 122.3, longitudeRef: "W"
            ) == nil
        )
        #expect(
            MediaCoordinate.fromExif(
                latitude: 47.6, latitudeRef: "N", longitude: nil, longitudeRef: "W"
            ) == nil
        )
    }

    @Test func 測位できていない0と範囲外は座標にしない() {
        #expect(
            MediaCoordinate.fromExif(
                latitude: 0, latitudeRef: "N", longitude: 0, longitudeRef: "E"
            ) == nil
        )
        #expect(
            MediaCoordinate.fromExif(
                latitude: 91, latitudeRef: "N", longitude: 10, longitudeRef: "E"
            ) == nil
        )
        #expect(
            MediaCoordinate.fromExif(
                latitude: 10, latitudeRef: "N", longitude: 181, longitudeRef: "E"
            ) == nil
        )
    }

    @Test func ISO6709の文字列から座標を取る() {
        #expect(
            MediaCoordinate.fromISO6709("+47.6205-122.3493+134.000/")
                == MediaCoordinate.Coordinate(latitude: 47.6205, longitude: -122.3493)
        )
        // 高度なし・終端スラッシュなしも読む
        #expect(
            MediaCoordinate.fromISO6709("-33.8688+151.2093")
                == MediaCoordinate.Coordinate(latitude: -33.8688, longitude: 151.2093)
        )
    }

    @Test func ISO6709として読めない文字列はnil() {
        #expect(MediaCoordinate.fromISO6709("") == nil)
        #expect(MediaCoordinate.fromISO6709("+47.6205/") == nil)
        // 度分秒表記は度として読むと範囲外になるので採用しない
        #expect(MediaCoordinate.fromISO6709("+4737.24-12220.96/") == nil)
    }
}
