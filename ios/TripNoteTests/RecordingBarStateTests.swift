import Foundation
import Testing
@testable import TripNote

// メモ: ArrivalEstimatorTests と同じく、unmanaged なエンティティ(コンテナ未挿入)だけで検証する。
@MainActor
struct RecordingBarStateTests {
    private func trip(
        _ title: String,
        startedAt: Date? = nil,
        endedAt: Date? = nil,
        deletedAt: Date? = nil
    ) -> TripEntity {
        let trip = TripEntity(title: title, startedAt: startedAt, endedAt: endedAt)
        trip.deletedAt = deletedAt
        return trip
    }

    // MARK: - 表示条件

    @Test func 記録中なら一覧に居てもバーを出す() throws {
        let recording = trip("記録中の旅行", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(
                for: .init(trips: [recording], recordingTrip: recording)
            )
        )
        #expect(content.trip.id == recording.id)
        #expect(content.isRecording)
    }

    @Test func 記録していなくても進行中の旅行があればバーを出す() throws {
        let ongoing = trip("進行中の旅行", startedAt: Date())
        let content = try #require(RecordingBarState.content(for: .init(trips: [ongoing])))
        #expect(content.trip.id == ongoing.id)
        #expect(!content.isRecording)
        #expect(content.detail == .idle)
    }

    @Test func 未終了の旅行を開いている間はバーを出す() throws {
        // 未出発(プラン中)でも、開いていれば記録を始められるように出す
        let planning = trip("プラン中の旅行")
        let content = try #require(
            RecordingBarState.content(for: .init(trips: [planning], openTrip: planning))
        )
        #expect(content.trip.id == planning.id)
        #expect(content.startedAt == nil)
    }

    @Test func 進行中の旅行が無く一覧に居るならバーを出さない() {
        let finished = trip("終わった旅行", startedAt: Date(), endedAt: Date())
        let planning = trip("プラン中の旅行")
        #expect(RecordingBarState.content(for: .init(trips: [finished, planning])) == nil)
    }

    @Test func 終了済みや削除済みの旅行は対象にしない() {
        let finished = trip("終わった旅行", startedAt: Date(), endedAt: Date())
        let deleted = trip("消した旅行", startedAt: Date(), deletedAt: Date())
        #expect(RecordingBarState.content(for: .init(openTrip: finished)) == nil)
        #expect(RecordingBarState.content(for: .init(trips: [deleted])) == nil)
    }

    // MARK: - 対象の旅行

    @Test func 対象は記録中の旅行を最優先にする() throws {
        let recording = trip("記録中", startedAt: Date())
        let open = trip("開いている", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(
                for: .init(trips: [recording, open], recordingTrip: recording, openTrip: open)
            )
        )
        #expect(content.trip.id == recording.id)
    }

    @Test func 記録していなければ開いている旅行を対象にする() throws {
        let open = trip("開いている", startedAt: Date(timeIntervalSince1970: 0))
        let ongoing = trip("進行中", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(for: .init(trips: [open, ongoing], openTrip: open))
        )
        #expect(content.trip.id == open.id)
    }

    @Test func 進行中の旅行が複数なら開始が新しい方を対象にする() throws {
        let older = trip("古い", startedAt: Date(timeIntervalSince1970: 1000))
        let newer = trip("新しい", startedAt: Date(timeIntervalSince1970: 2000))
        let content = try #require(RecordingBarState.content(for: .init(trips: [older, newer])))
        #expect(content.trip.id == newer.id)
    }

    // MARK: - 2 行目の内容

    @Test func 記録中は地点数と距離を出す() throws {
        let recording = trip("記録中", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(
                for: .init(
                    recordingTrip: recording,
                    recordedPointCount: 318,
                    totalDistanceMeters: 142_600
                )
            )
        )
        #expect(content.detail == .recording(pointCount: 318, distanceMeters: 142_600))
    }

    @Test func 位置情報が拒否されていればエラーと設定への導線を出す() throws {
        let ongoing = trip("進行中", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(for: .init(trips: [ongoing], isLocationDenied: true))
        )
        #expect(content.detail == .error(message: RecordingBarState.deniedText, showsSettings: true))
    }

    @Test func 記録のエラーは拒否でなくてもそのまま出す() throws {
        let ongoing = trip("進行中", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(for: .init(trips: [ongoing], locationError: "保存に失敗しました"))
        )
        #expect(content.detail == .error(message: "保存に失敗しました", showsSettings: false))
    }

    @Test func 位置情報が長く途切れていれば再取得中と出す() throws {
        let recording = trip("記録中", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(
                for: .init(recordingTrip: recording, recordedPointCount: 12, isStalled: true)
            )
        )
        #expect(content.detail == .stalled)
        #expect(content.isRecording)
    }

    @Test func 記録していなければ途切れていても再取得中とは出さない() throws {
        let ongoing = trip("進行中", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(for: .init(trips: [ongoing], isStalled: true))
        )
        #expect(content.detail == .idle)
    }

    @Test func 途切れていてもエラーがあればエラーを優先して出す() throws {
        let recording = trip("記録中", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(
                for: .init(
                    recordingTrip: recording,
                    locationError: "保存に失敗しました",
                    isStalled: true
                )
            )
        )
        #expect(content.detail == .error(message: "保存に失敗しました", showsSettings: false))
    }

    @Test func 取り込み中は記録中でも取り込みを優先して出す() throws {
        let recording = trip("記録中", startedAt: Date())
        let content = try #require(
            RecordingBarState.content(
                for: .init(recordingTrip: recording, recordedPointCount: 5, isImporting: true)
            )
        )
        #expect(content.detail == .importing)
        #expect(content.isRecording)
    }

    // MARK: - 文言の整形

    @Test func 経過時間は時分で出し24時間を超えたら日数も付ける() {
        let start = Date(timeIntervalSince1970: 0)
        #expect(RecordingBarState.elapsedText(from: start, to: start) == "0:00")
        #expect(RecordingBarState.elapsedText(from: start, to: start.addingTimeInterval(59)) == "0:00")
        #expect(RecordingBarState.elapsedText(from: start, to: start.addingTimeInterval(9660)) == "2:41")
        #expect(
            RecordingBarState.elapsedText(from: start, to: start.addingTimeInterval(93_780))
                == "1日 2:03"
        )
    }

    @Test func 開始が未来なら経過時間は出さない() {
        let start = Date(timeIntervalSince1970: 1000)
        #expect(RecordingBarState.elapsedText(from: start, to: start.addingTimeInterval(-10)) == nil)
    }

    @Test func 地点数と距離の整形() {
        #expect(RecordingBarState.pointCountText(318) == "318 地点")
        #expect(RecordingBarState.distanceText(940) == "940 m")
        #expect(RecordingBarState.distanceText(142_600) == "142.60 km")
    }
}
