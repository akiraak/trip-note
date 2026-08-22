import Testing
@testable import TripNote

/// 逆ジオコーディング結果から出発地名を合成するロジックの検証
/// (CLGeocoder 自体は使わない pure な部分のみ)
struct OneShotLocationProviderTests {
    @Test func 市区町村名を前置する() {
        let name = OneShotLocationProvider.composedPlaceName(
            name: "5th Ave 401", city: "シアトル"
        )
        #expect(name == "シアトル 5th Ave 401")
    }

    @Test func nameが市区町村を含むなら重複させない() {
        let name = OneShotLocationProvider.composedPlaceName(
            name: "シアトル中央図書館", city: "シアトル"
        )
        #expect(name == "シアトル中央図書館")
    }

    @Test func 片方だけでも返す() {
        #expect(OneShotLocationProvider.composedPlaceName(name: "松本駅", city: nil) == "松本駅")
        #expect(OneShotLocationProvider.composedPlaceName(name: nil, city: "松本市") == "松本市")
        #expect(OneShotLocationProvider.composedPlaceName(name: nil, city: nil) == nil)
    }
}
