import SwiftData
import SwiftUI
import UIKit

@main
struct TripNoteApp: App {
    private let container: ModelContainer
    @State private var recorder: LocationRecorder
    @State private var sync: SyncEngine
    @State private var importer: MediaImporter
    /// 記録バーの対象を決めるための「いま開いている旅行」
    @State private var activeTrip = ActiveTripContext()

    init() {
        do {
            let container = try ModelContainer(
                for: TripEntity.self, LocationPointEntity.self, MediaEntity.self,
                TripDayEntity.self, CheckpointEntity.self
            )
            self.container = container
            let recorder = LocationRecorder(modelContext: container.mainContext)
            _recorder = State(initialValue: recorder)
            _sync = State(initialValue: SyncEngine(modelContext: container.mainContext))
            _importer = State(initialValue: MediaImporter(modelContext: container.mainContext))
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
                .environment(sync)
                .environment(importer)
                .environment(activeTrip)
                // デザインは案 C「ルートキャンバス」でダーク固定
                // (OS がライトでもダークで出す。docs/plans/design-refresh.md)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                // preferredColorScheme は SwiftUI のビューにしか効かず、
                // MapKit(UIKit 側)はシステムの外観のままになる。地図もダークにするため
                // ウィンドウの外観自体を固定する
                .background(DarkWindow())
        }
        .modelContainer(container)
    }
}

/// ウィンドウの外観をダークに固定する。SwiftUI の preferredColorScheme だけでは
/// MapKit(UIKit)まで届かず地図がライトのままになるため、window を直接掴んで指定する
private struct DarkWindow: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        // 追加直後は window がまだ nil なので、次のループで設定する
        DispatchQueue.main.async {
            uiView.window?.overrideUserInterfaceStyle = .dark
        }
    }
}
