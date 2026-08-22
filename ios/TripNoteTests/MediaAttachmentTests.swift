import Foundation
import Testing
@testable import TripNote

struct MediaAttachmentTests {
    private func dates(_ seconds: [Double]) -> [Date] {
        seconds.map { Date(timeIntervalSince1970: $0) }
    }

    @Test func 点が無ければ紐付け先はない() {
        #expect(MediaAttachment.nearestIndex(recordedTimes: [], to: Date()) == nil)
    }

    @Test func 撮影時刻に最も近い点を選ぶ() {
        let times = dates([0, 100, 200])
        #expect(MediaAttachment.nearestIndex(recordedTimes: times, to: Date(timeIntervalSince1970: 130)) == 1)
        #expect(MediaAttachment.nearestIndex(recordedTimes: times, to: Date(timeIntervalSince1970: 199)) == 2)
    }

    @Test func 記録範囲の外でも端の点を選ぶ() {
        let times = dates([100, 200])
        #expect(MediaAttachment.nearestIndex(recordedTimes: times, to: Date(timeIntervalSince1970: 0)) == 0)
        #expect(MediaAttachment.nearestIndex(recordedTimes: times, to: Date(timeIntervalSince1970: 500)) == 1)
    }

    @Test func 同差なら先の点を選ぶ() {
        let times = dates([0, 100])
        #expect(MediaAttachment.nearestIndex(recordedTimes: times, to: Date(timeIntervalSince1970: 50)) == 0)
    }
}
