import CoreLocation
import Foundation
import Testing
@testable import TripNote

struct RecordingWatchdogTests {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func input(
        isIntended: Bool = true,
        isRecording: Bool = true,
        authorization: CLAuthorizationStatus = .authorizedAlways,
        isRequestingAuthorization: Bool = false,
        silentFor seconds: TimeInterval = 0
    ) -> RecordingWatchdog.Input {
        RecordingWatchdog.Input(
            isIntended: isIntended,
            isRecording: isRecording,
            authorization: authorization,
            isRequestingAuthorization: isRequestingAuthorization,
            lastUpdateAt: now.addingTimeInterval(-seconds),
            now: now
        )
    }

    // MARK: - 意思が無いとき

    @Test func 記録の意思が無ければ何もしない() {
        #expect(RecordingWatchdog.decide(input(isIntended: false, isRecording: false)) == .none)
        // 権限が無くても、意思が無いなら知らせることは無い
        #expect(
            RecordingWatchdog.decide(
                input(isIntended: false, isRecording: false, authorization: .denied)
            ) == .none
        )
    }

    // MARK: - 権限

    @Test func 権限が無ければ自動では戻さず知らせる() {
        #expect(RecordingWatchdog.decide(input(isRecording: false, authorization: .denied)) == .denied)
        #expect(
            RecordingWatchdog.decide(input(isRecording: false, authorization: .restricted)) == .denied
        )
    }

    @Test func 権限が未確定なら許可を求める() {
        #expect(
            RecordingWatchdog.decide(input(isRecording: false, authorization: .notDetermined))
                == .requestAuthorization
        )
    }

    @Test func 権限ダイアログの応答待ちなら要求を重ねない() {
        #expect(
            RecordingWatchdog.decide(
                input(
                    isRecording: false,
                    authorization: .notDetermined,
                    isRequestingAuthorization: true
                )
            ) == .none
        )
    }

    @Test func 使用中の許可でも記録は再開する() {
        #expect(
            RecordingWatchdog.decide(input(isRecording: false, authorization: .authorizedWhenInUse))
                == .resume
        )
    }

    // MARK: - 再開と入れ直し

    @Test func 意思があるのに記録していなければ再開する() {
        #expect(RecordingWatchdog.decide(input(isRecording: false)) == .resume)
    }

    @Test func 更新が届いていれば何もしない() {
        #expect(RecordingWatchdog.decide(input(silentFor: 60)) == .none)
    }

    @Test func 更新が途切れていれば購読を入れ直す() {
        #expect(
            RecordingWatchdog.decide(
                input(silentFor: RecordingWatchdog.staleThreshold + 1)
            ) == .restart
        )
    }

    @Test func 閾値ちょうどはまだ入れ直さない() {
        #expect(RecordingWatchdog.decide(input(silentFor: RecordingWatchdog.staleThreshold)) == .none)
    }

    @Test func 最終受信が不明なら止まっている扱いにしない() {
        // 記録の開始・入れ直しで「今」が入るため、記録中に nil は通常起きない
        var value = input()
        value.lastUpdateAt = nil
        #expect(RecordingWatchdog.decide(value) == .none)
    }

    // MARK: - 表示に出す判定

    @Test func 入れ直しても戻らないほど途切れたら表示に出す() {
        #expect(
            !RecordingWatchdog.isStalled(
                lastUpdateAt: now.addingTimeInterval(-RecordingWatchdog.staleThreshold - 1),
                now: now
            )
        )
        #expect(
            !RecordingWatchdog.isStalled(
                lastUpdateAt: now.addingTimeInterval(-RecordingWatchdog.stalledThreshold),
                now: now
            )
        )
        #expect(
            RecordingWatchdog.isStalled(
                lastUpdateAt: now.addingTimeInterval(-RecordingWatchdog.stalledThreshold - 1),
                now: now
            )
        )
        #expect(!RecordingWatchdog.isStalled(lastUpdateAt: nil, now: now))
    }
}
