import Foundation
import Testing
@testable import TripNote

struct CategorySearchTests {
    @Test func 観光地などの完全一致だけカテゴリ検索になる() {
        #expect(SearchCategory.match("観光地") == .sightseeing)
        #expect(SearchCategory.match(" 観光 ") == .sightseeing)
        #expect(SearchCategory.match("観光スポット") == .sightseeing)
        #expect(SearchCategory.match("名所") == .sightseeing)
        #expect(SearchCategory.match("松本城") == nil)
        #expect(SearchCategory.match("松本 観光地") == nil)
        #expect(SearchCategory.match("") == nil)
    }

    @Test func 観光地の結果はチェックポイント種別が観光になる() {
        #expect(SearchCategory.sightseeing.checkpointType == .sightseeing)
        #expect(SearchCategory.sightseeing.rawValue == "sightseeing")
    }
}
