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

    @Test func 日数宿泊地候補の応答をデコードする() throws {
        let json = """
        {
          "candidates": [
            {
              "dayCount": 3,
              "title": "2泊3日でゆったり",
              "nights": [
                { "area": "松本市街", "name": "松本駅周辺のホテル", "note": null,
                  "latitude": 36.23, "longitude": 137.97 },
                { "area": "上高地", "name": "上高地の宿", "note": "要予約" }
              ]
            },
            { "dayCount": 1, "title": "日帰り", "nights": [] }
          ]
        }
        """
        let suggestion = try JSONDecoder().decode(
            AITripOutlineSuggestion.self, from: Data(json.utf8)
        )
        #expect(suggestion.candidates.map(\.dayCount) == [3, 1])
        #expect(suggestion.candidates[0].nights.map(\.name)
            == ["松本駅周辺のホテル", "上高地の宿"])
        #expect(suggestion.candidates[0].nights[1].note == "要予約")
        // プレビュー地図用の概算座標(無い泊は nil)
        #expect(suggestion.candidates[0].nights[0].latitude == 36.23)
        #expect(suggestion.candidates[0].nights[0].longitude == 137.97)
        #expect(suggestion.candidates[0].nights[1].latitude == nil)
        #expect(suggestion.candidates[1].nights.isEmpty)
    }

    @Test func 日数宿泊地候補のリクエストはサーバの期待するキーで送る() throws {
        let body = AITripOutlineRequest(
            destination: "シカゴ",
            departureDate: "2026-09-01",
            departureTime: "08:30",
            departure: "シアトル",
            departureLatitude: 47.6062,
            departureLongitude: -122.3321,
            transport: "car",
            request: nil
        )
        let data = try JSONEncoder().encode(body)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(object?["destination"] as? String == "シカゴ")
        #expect(object?["departureDate"] as? String == "2026-09-01")
        #expect(object?["departureTime"] as? String == "08:30")
        #expect(object?["departure"] as? String == "シアトル")
        #expect(object?["departureLatitude"] as? Double == 47.6062)
        #expect(object?["departureLongitude"] as? Double == -122.3321)
        #expect(object?["transport"] as? String == "car")
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
