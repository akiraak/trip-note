import SwiftData
import SwiftUI

@main
struct TripNoteApp: App {
    private let container: ModelContainer
    @State private var recorder: LocationRecorder

    init() {
        do {
            let container = try ModelContainer(for: TripEntity.self, LocationPointEntity.self)
            self.container = container
            let recorder = LocationRecorder(modelContext: container.mainContext)
            _recorder = State(initialValue: recorder)
            // significant location change によるバックグラウンド再起動時も
            // UI 表示を待たずに記録を再開する
            recorder.resumeIfNeeded()
        } catch {
            fatalError("ModelContainer の初期化に失敗しました: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(recorder)
        }
        .modelContainer(container)
    }
}
