import Foundation
import Testing
@testable import TripNote

struct ShareInboxTests {
    private func makeInbox() -> ShareInbox {
        let suite = "ShareInboxTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return ShareInbox(defaults: defaults)
    }

    @Test func 追加した共有を順に取り出せて削除できる() {
        let inbox = makeInbox()
        #expect(inbox.pending().isEmpty)
        let first = PendingShare(text: "松本城\nhttps://maps.app.goo.gl/a", url: "https://maps.app.goo.gl/a")
        let second = PendingShare(text: nil, url: "https://maps.app.goo.gl/b")
        inbox.append(first)
        inbox.append(second)
        #expect(inbox.pending() == [first, second])
        inbox.remove(id: first.id)
        #expect(inbox.pending() == [second])
        inbox.remove(id: first.id)  // 二重削除は無害
        #expect(inbox.pending() == [second])
        inbox.removeAll()
        #expect(inbox.pending().isEmpty)
    }

    @Test func 取り込みに使う文字列はテキスト優先() {
        let both = PendingShare(text: "松本城\nhttps://maps.app.goo.gl/a", url: "https://maps.app.goo.gl/a")
        #expect(both.link == "松本城\nhttps://maps.app.goo.gl/a")
        let urlOnly = PendingShare(text: nil, url: "https://maps.app.goo.gl/b")
        #expect(urlOnly.link == "https://maps.app.goo.gl/b")
        let blankText = PendingShare(text: "  \n", url: "https://maps.app.goo.gl/c")
        #expect(blankText.link == "https://maps.app.goo.gl/c")
        #expect(PendingShare(text: nil, url: nil).link == nil)
    }

    @Test func 壊れたデータは空として扱う() {
        let inbox = makeInbox()
        inbox.defaults.set(Data("not json".utf8), forKey: ShareInbox.key)
        #expect(inbox.pending().isEmpty)
    }
}
