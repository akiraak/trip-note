import Foundation
import Testing
@testable import TripNote

struct RouteRecordsTests {
    @Test func 応答をデコードできる_未解決レグはnil() throws {
        let json = """
        {"legs":[
          {"coordinates":[[137.9719,36.2381],[137.7,36.2],[137.5502,36.1451]],
           "distanceM":1234.5,"durationS":678.9},
          null
        ]}
        """
        let response = try JSONDecoder().decode(RouteResponse.self, from: Data(json.utf8))
        #expect(response.legs.count == 2)
        let leg = try #require(response.legs[0])
        // coordinates は GeoJSON の [lon, lat] 順
        #expect(leg.points.first == RoutePoint(latitude: 36.2381, longitude: 137.9719))
        #expect(leg.points.count == 3)
        #expect(leg.distanceM == 1234.5)
        #expect(leg.durationS == 678.9)
        #expect(response.legs[1] == nil)
    }

    @Test func 要素数が足りない座標ペアはpointsで捨てる() throws {
        let json = """
        {"legs":[{"coordinates":[[137.9719],[137.5502,36.1451]],"distanceM":1,"durationS":1}]}
        """
        let response = try JSONDecoder().decode(RouteResponse.self, from: Data(json.utf8))
        let leg = try #require(response.legs[0])
        #expect(leg.points == [RoutePoint(latitude: 36.1451, longitude: 137.5502)])
    }

    @Test func リクエストはfrom_toの緯度経度をエンコードする() throws {
        let request = RouteRequest(legs: [
            .init(
                from: RoutePoint(latitude: 36.2381, longitude: 137.9719),
                to: RoutePoint(latitude: 36.1451, longitude: 137.5502)
            ),
        ])
        let data = try JSONEncoder().encode(request)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: [[String: [String: Double]]]]
        let leg = try #require(object?["legs"]?.first)
        #expect(leg["from"]?["latitude"] == 36.2381)
        #expect(leg["from"]?["longitude"] == 137.9719)
        #expect(leg["to"]?["latitude"] == 36.1451)
        #expect(leg["to"]?["longitude"] == 137.5502)
    }
}
