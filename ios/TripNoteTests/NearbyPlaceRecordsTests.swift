import Foundation
import Testing
@testable import TripNote

struct NearbyPlaceRecordsTests {
    @Test func 近くの地点の応答をデコードする() throws {
        let json = """
        {"places": [
          {"id": "way/300077872", "name": "松本城", "kind": "castle", "kindLabel": "城",
           "latitude": 36.2387, "longitude": 137.9689, "distanceM": 1200,
           "nearestRouteName": "宿 A",
           "wikipediaUrl": "https://ja.wikipedia.org/wiki/%E6%9D%BE%E6%9C%AC%E5%9F%8E", "website": null},
          {"id": "node/1", "name": "上高地", "kind": "attraction", "kindLabel": "観光スポット",
           "latitude": 36.246, "longitude": 137.636, "distanceM": 700,
           "nearestRouteName": "上高地", "wikipediaUrl": null, "website": "https://example.com"}
        ]}
        """
        let response = try JSONDecoder().decode(NearbyPlacesResponse.self, from: Data(json.utf8))
        #expect(response.places.map(\.name) == ["松本城", "上高地"])
        #expect(response.places[0].kindLabel == "城")
        #expect(response.places[0].distanceM == 1200)
        #expect(response.places[0].wikipediaUrl?.hasPrefix("https://ja.wikipedia.org/") == true)
        #expect(response.places[0].website == nil)
        #expect(response.places[1].website == "https://example.com")
    }

    @Test func リクエストはカテゴリと経路を送る() throws {
        let body = NearbyPlacesRequest(
            category: SearchCategory.sightseeing.rawValue,
            route: [DayRoutePlace(name: "宿 A", latitude: 36.23, longitude: 137.97)]
        )
        let data = try JSONEncoder().encode(body)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(object?["category"] as? String == "sightseeing")
        let route = try #require(object?["route"] as? [[String: Any]])
        #expect(route.count == 1)
        #expect(route[0]["name"] as? String == "宿 A")
        #expect(route[0]["longitude"] as? Double == 137.97)
    }
}
