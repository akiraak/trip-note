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
        #expect(!response.place.isCenterOnly)
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
        #expect(centerPlace.isCenterOnly)
    }
}
