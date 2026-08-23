import Foundation
import Testing
@testable import TripNote

/// AI 提案 DTO(Models/AIRecords.swift)のエンコード/デコードを検証する
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
                { "type": "departure", "name": "東京駅", "note": null,
                  "latitude": 35.681, "longitude": 139.767 },
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
        // 概算座標(無ければ nil)
        #expect(day.checkpoints[0].latitude == 35.681)
        #expect(day.checkpoints[0].longitude == 139.767)
        #expect(day.checkpoints[1].latitude == nil)
    }

    @Test func 日数宿泊地候補の応答をデコードする() throws {
        let json = """
        {
          "destinationLatitude": 41.8781,
          "destinationLongitude": -87.6298,
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
        // 目的地の概算座標(候補共通)
        #expect(suggestion.destinationLatitude == 41.8781)
        #expect(suggestion.destinationLongitude == -87.6298)
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

    @Test func 生成ジョブの登録リクエストは入力をネストして送る() throws {
        let body = AIJobCreateRequest(
            id: "0b7e4a52-1f0f-4c4c-9a3e-2f4f8f0d1234",
            kind: "trip_outline",
            input: AITripOutlineRequest(
                destination: "上高地",
                departureDate: "2026-09-01",
                departureTime: "08:00",
                departure: nil,
                departureLatitude: nil,
                departureLongitude: nil,
                transport: nil,
                request: nil
            )
        )
        let data = try JSONEncoder().encode(body)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(object?["id"] as? String == "0b7e4a52-1f0f-4c4c-9a3e-2f4f8f0d1234")
        #expect(object?["kind"] as? String == "trip_outline")
        let input = object?["input"] as? [String: Any]
        #expect(input?["destination"] as? String == "上高地")
        #expect(input?["departureDate"] as? String == "2026-09-01")
    }

    @Test func 生成ジョブの状態応答をデコードする() throws {
        // 実行中(result / error なし)
        let running = try JSONDecoder().decode(
            AIJobStatusResponse<AIPlanSuggestion>.self,
            from: Data(#"{ "id": "a", "status": "running", "result": null, "error": null }"#.utf8)
        )
        #expect(running.status == "running")
        #expect(running.result == nil)

        // 成功(result に kind ごとの提案が入る)
        let succeeded = try JSONDecoder().decode(
            AIJobStatusResponse<AIPlanSuggestion>.self,
            from: Data("""
            { "id": "a", "status": "succeeded", "error": null,
              "result": { "days": [ { "date": "2026-09-01", "title": "移動日",
                "area": "松本市", "checkpoints": [] } ] } }
            """.utf8)
        )
        #expect(succeeded.result?.days.map(\.title) == ["移動日"])

        // 失敗(error にサーバのメッセージ)
        let failed = try JSONDecoder().decode(
            AIJobStatusResponse<AIPlanSuggestion>.self,
            from: Data(#"{ "id": "a", "status": "failed", "result": null, "error": "boom" }"#.utf8)
        )
        #expect(failed.status == "failed")
        #expect(failed.error == "boom")
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
