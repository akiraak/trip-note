import Foundation
import Testing
@testable import TripNote

struct GoogleMapsLinkTests {
    @Test func 座標がクエリに入る() {
        let url = GoogleMapsLink.searchURL(latitude: 35.681236, longitude: 139.767125)
        #expect(
            url.absoluteString
                == "https://www.google.com/maps/search/?api=1&query=35.681236,139.767125"
        )
    }

    @Test func 負の座標と小数6桁への丸め() {
        let url = GoogleMapsLink.searchURL(latitude: -33.86748456, longitude: -151.20699789)
        #expect(
            url.absoluteString
                == "https://www.google.com/maps/search/?api=1&query=-33.867485,-151.206998"
        )
    }

    @Test func 整数座標も小数6桁で出す() {
        let url = GoogleMapsLink.searchURL(latitude: 35, longitude: 139)
        #expect(
            url.absoluteString
                == "https://www.google.com/maps/search/?api=1&query=35.000000,139.000000"
        )
    }
}
