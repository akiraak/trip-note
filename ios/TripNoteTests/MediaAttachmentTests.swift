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

    @Test func 記録範囲の内側なら時間差が開いていても紐付ける() {
        // 静止中は点が増えないため、範囲の内側は時間差で弾かない
        let times = dates([0, 36_000])
        #expect(MediaAttachment.nearestIndex(recordedTimes: times, to: Date(timeIntervalSince1970: 3_600)) == 0)
        #expect(MediaAttachment.nearestIndex(recordedTimes: times, to: Date(timeIntervalSince1970: 32_400)) == 1)
    }

    @Test func 記録範囲の外でも許容内なら端の点を選ぶ() {
        let times = dates([10_000, 20_000])
        let tolerance = MediaAttachment.outsideTolerance
        #expect(
            MediaAttachment.nearestIndex(
                recordedTimes: times, to: Date(timeIntervalSince1970: 10_000 - tolerance)
            ) == 0
        )
        #expect(
            MediaAttachment.nearestIndex(
                recordedTimes: times, to: Date(timeIntervalSince1970: 20_000 + tolerance)
            ) == 1
        )
    }

    @Test func 記録範囲から離れすぎた撮影は紐付けない() {
        let times = dates([10_000, 20_000])
        let tolerance = MediaAttachment.outsideTolerance
        #expect(
            MediaAttachment.nearestIndex(
                recordedTimes: times, to: Date(timeIntervalSince1970: 10_000 - tolerance - 1)
            ) == nil
        )
        #expect(
            MediaAttachment.nearestIndex(
                recordedTimes: times, to: Date(timeIntervalSince1970: 20_000 + tolerance + 1)
            ) == nil
        )
    }

    @Test func 許容時間差は呼び出し側で変えられる() {
        let times = dates([100])
        #expect(
            MediaAttachment.nearestIndex(
                recordedTimes: times, to: Date(timeIntervalSince1970: 160), tolerance: 60
            ) == 0
        )
        #expect(
            MediaAttachment.nearestIndex(
                recordedTimes: times, to: Date(timeIntervalSince1970: 161), tolerance: 60
            ) == nil
        )
    }

    @Test func 同差なら先の点を選ぶ() {
        let times = dates([0, 100])
        #expect(MediaAttachment.nearestIndex(recordedTimes: times, to: Date(timeIntervalSince1970: 50)) == 0)
    }
}
