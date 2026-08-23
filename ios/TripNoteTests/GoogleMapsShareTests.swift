import Foundation
import Testing
@testable import TripNote

struct GoogleMapsShareTests {
    private let shortLink = "https://maps.app.goo.gl/AbCdEfGh12345678"

    @Test func 共有テキストから短縮リンクを取り出す() {
        #expect(GoogleMapsShare.extractURL(from: "松本城\n\(shortLink)")?.absoluteString == shortLink)
        #expect(GoogleMapsShare.extractURL(from: shortLink)?.absoluteString == shortLink)
        #expect(GoogleMapsShare.extractURL(from: "ここ(\(shortLink))。")?.absoluteString == shortLink)
        #expect(GoogleMapsShare.extractURL(from: "\(shortLink)、見て")?.absoluteString == shortLink)
    }

    @Test func 場所ページの長いURLも取り出せる() {
        let place = "https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E/@36.238653,137.9688674,17z/data=!3m1!4b1!8m2!3d36.238653!4d137.9688674?hl=ja"
        #expect(GoogleMapsShare.extractURL(from: place)?.absoluteString == place)
    }

    @Test func GoogleMaps以外のURLやURL無しはnil() {
        #expect(GoogleMapsShare.extractURL(from: "https://example.com/maps/place/x") == nil)
        #expect(GoogleMapsShare.extractURL(from: "松本城") == nil)
        #expect(GoogleMapsShare.extractURL(from: "") == nil)
        // 先に別サイトの URL があっても Google Maps のものを選ぶ
        #expect(GoogleMapsShare.extractURL(from: "https://example.com \(shortLink)")?.absoluteString == shortLink)
    }

    @Test func ホストの許可リストで判定する() {
        #expect(GoogleMapsShare.isGoogleMapsURL(URL(string: "https://maps.google.co.jp/?q=1,2")!))
        #expect(!GoogleMapsShare.isGoogleMapsURL(URL(string: "https://evil.google.com.example/")!))
        #expect(!GoogleMapsShare.isGoogleMapsURL(URL(string: "ftp://www.google.com/maps")!))
    }

    @Test func 名前のヒントはURLを含まない最初の行() {
        #expect(GoogleMapsShare.nameHint(from: "松本城\n\(shortLink)") == "松本城")
        #expect(GoogleMapsShare.nameHint(from: "\(shortLink)\n松本城") == "松本城")
        #expect(GoogleMapsShare.nameHint(from: "  \n松本城  \n") == "松本城")
        #expect(GoogleMapsShare.nameHint(from: shortLink) == nil)
        #expect(GoogleMapsShare.nameHint(from: "") == nil)
    }
}
