import Foundation
import Testing
@testable import TripNote

/// AI 提案・検索補助 DTO(Models/AIRecords.swift)のエンコード/デコードを検証する
struct AIRecordsTests {
    @Test func プラン提案の応答をデコードし未知の種別はotherに寄せる() throws {
        let json = """
        {
          "days": [
            {
              "date": "2026-09-01",
              "title": "松本周辺を観光して泊",
              "area": "松本市",
              "checkpoints": [
                { "type": "departure", "name": "東京駅", "note": null },
                { "type": "onsen", "name": "浅間温泉", "note": "未知の種別" }
              ]
            }
          ]
        }
        """
        let suggestion = try JSONDecoder().decode(
            AIPlanSuggestion.self, from: Data(json.utf8)
        )
        #expect(suggestion.days.count == 1)
        let day = suggestion.days[0]
        #expect(day.date == "2026-09-01")
        #expect(day.area == "松本市")
        #expect(day.checkpoints.map(\.type) == [.departure, .other])
        #expect(day.checkpoints[1].note == "未知の種別")
    }

    @Test func 検索補助の応答をデコードする() throws {
        let json = """
        {
          "queries": ["松本市 カフェ"],
          "places": [
            { "type": "cafe", "name": "珈琲まるも", "area": "松本市", "note": null }
          ]
        }
        """
        let suggestion = try JSONDecoder().decode(
            AISearchAssistSuggestion.self, from: Data(json.utf8)
        )
        #expect(suggestion.queries == ["松本市 カフェ"])
        #expect(suggestion.places.map(\.type) == [.cafe])
        #expect(suggestion.places[0].note == nil)
    }

    @Test func プラン提案のリクエストはサーバの期待するキーで送る() throws {
        let body = AIPlanRequest(
            departure: "東京駅",
            destination: "自宅",
            startDate: "2026-09-01",
            dayCount: 3,
            transport: "car",
            request: nil
        )
        let data = try JSONEncoder().encode(body)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(object?["departure"] as? String == "東京駅")
        #expect(object?["startDate"] as? String == "2026-09-01")
        #expect(object?["dayCount"] as? Int == 3)
        #expect(object?["transport"] as? String == "car")
    }
}
