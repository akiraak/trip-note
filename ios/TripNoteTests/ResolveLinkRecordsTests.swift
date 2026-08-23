import Foundation
import Testing
@testable import TripNote

struct ResolveLinkRecordsTests {
    @Test func リクエストはlinkだけを送る() throws {
        let data = try JSONEncoder().encode(ResolveLinkRequest(link: "松本城\nhttps://maps.app.goo.gl/a"))
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["link"] as? String == "松本城\nhttps://maps.app.goo.gl/a")
        #expect(json.count == 1)
    }

    @Test func サーバ応答をデコードできる() throws {
        let json = """
        {"place":{"name":"松本城","latitude":36.238653,"longitude":137.9688674,"precision":"pin",
        "resolvedUrl":"https://www.google.com/maps/place/x"}}
        """
        let response = try JSONDecoder().decode(ResolveLinkResponse.self, from: Data(json.utf8))
        #expect(response.place.name == "松本城")
        #expect(response.place.latitude == 36.238653)
        #expect(response.place.hasCoordinate)
        #expect(response.place.approximationNote == nil)
        // geocodedQuery が無い古い応答でもデコードできる
        #expect(response.place.geocodedQuery == nil)
    }

    @Test func 住所からの推定には注記が付く() throws {
        let json = """
        {"place":{"name":"Hotel Ruby | Spokane","latitude":47.65,"longitude":-117.42,"precision":"geocoded",
        "resolvedUrl":"u","geocodedQuery":"Hotel Ruby | Spokane, 901 W 1st Ave, Spokane, WA 99201"}}
        """
        let place = try JSONDecoder().decode(ResolveLinkResponse.self, from: Data(json.utf8)).place
        #expect(place.approximationNote?.contains("住所から推定") == true)
        #expect(place.approximationNote?.contains("901 W 1st Ave") == true)
        let area = """
        {"place":{"name":"x","latitude":36.2,"longitude":137.9,"precision":"area","resolvedUrl":"u","geocodedQuery":"長野県松本市丸の内"}}
        """
        let areaPlace = try JSONDecoder().decode(ResolveLinkResponse.self, from: Data(area.utf8)).place
        #expect(areaPlace.approximationNote?.contains("おおよその位置") == true)
    }

    @Test func 座標なし応答と中心のみ応答() throws {
        let nameOnly = """
        {"place":{"name":"松本城","latitude":null,"longitude":null,"precision":null,"resolvedUrl":"u"}}
        """
        let place = try JSONDecoder().decode(ResolveLinkResponse.self, from: Data(nameOnly.utf8)).place
        #expect(!place.hasCoordinate)
        #expect(place.precision == nil)
        let center = """
        {"place":{"name":null,"latitude":36.2,"longitude":137.9,"precision":"center","resolvedUrl":"u"}}
        """
        let centerPlace = try JSONDecoder().decode(ResolveLinkResponse.self, from: Data(center.utf8)).place
        #expect(centerPlace.name == nil)
        #expect(centerPlace.approximationNote?.contains("地図の中心") == true)
    }
}
