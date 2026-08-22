import Foundation
import Testing
@testable import TripNote

struct TrackSegmentsTests {
    private struct Sample {
        let name: String
        let recordedAt: Date
    }

    private func sample(_ name: String, at seconds: TimeInterval) -> Sample {
        Sample(name: name, recordedAt: Date(timeIntervalSince1970: seconds))
    }

    @Test func 空の点列は空の区間になる() {
        let segments = TrackSegmenter.split([Sample](), recordedAt: \.recordedAt)
        #expect(segments.isEmpty)
    }

    @Test func ギャップが無ければ1区間のまま() {
        let points = [
            sample("a", at: 0),
            sample("b", at: 60),
            sample("c", at: 120),
        ]
        let segments = TrackSegmenter.split(points, recordedAt: \.recordedAt)
        #expect(segments.count == 1)
        #expect(segments[0].map(\.name) == ["a", "b", "c"])
    }

    @Test func 閾値を超えたギャップで区間が分かれる() {
        let points = [
            sample("a", at: 0),
            sample("b", at: 60),
            // 10 分 + 1 秒のギャップ
            sample("c", at: 60 + 10 * 60 + 1),
            sample("d", at: 60 + 10 * 60 + 61),
        ]
        let segments = TrackSegmenter.split(points, recordedAt: \.recordedAt)
        #expect(segments.count == 2)
        #expect(segments[0].map(\.name) == ["a", "b"])
        #expect(segments[1].map(\.name) == ["c", "d"])
    }

    @Test func ちょうど閾値のギャップは分割しない() {
        let points = [
            sample("a", at: 0),
            sample("b", at: TrackSegmenter.gapThreshold),
        ]
        let segments = TrackSegmenter.split(points, recordedAt: \.recordedAt)
        #expect(segments.count == 1)
    }

    @Test func 複数ギャップで孤立点も区間になる() {
        let points = [
            sample("a", at: 0),
            sample("b", at: 30 * 60),
            sample("c", at: 60 * 60),
        ]
        let segments = TrackSegmenter.split(points, recordedAt: \.recordedAt)
        #expect(segments.count == 3)
        #expect(segments.map { $0.map(\.name) } == [["a"], ["b"], ["c"]])
    }

    @Test func 閾値は指定できる() {
        let points = [
            sample("a", at: 0),
            sample("b", at: 10),
        ]
        let segments = TrackSegmenter.split(points, recordedAt: \.recordedAt, gapThreshold: 5)
        #expect(segments.count == 2)
    }
}
