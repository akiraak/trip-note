# GPS 記録の ON/OFF を保存し、動いていなければ自動で再開する（実装プラン）

TODO: 「クライアント側で GPS の on,off を保存し on なのに機能していなかったら自動で開始するようにする」

## 目的・背景

移動中に記録が黙って止まっていると、その区間の軌跡が丸ごと失われる。しかも今の UI は
「記録中」と出したままなので、ユーザーは止まっていることに気づけない。

現状を調べたところ、**ON/OFF の保存自体は既にできている**。

- 意思の保存: `TripEntity.isRecordingActive`（`Models/Entities.swift:25`。ローカル専用・同期しない）
- 起動時の再開: `TripNoteApp.init` → `LocationRecorder.resumeIfNeeded()`（`Services/LocationRecorder.swift:81`）
- 権限が変わったときの再開: `handleAuthorizationChange` → `startIfPending` → `resumeIfNeeded`

足りないのは **「ON のまま実際には止まっている」状態の検知と自動復帰**。穴は 4 つ。

| # | 穴 | 起きること |
| --- | --- | --- |
| ① | `resumeIfNeeded()` は権限が未確定だと黙って return し（`LocationRecorder.swift:82`）、再試行の口が権限変化イベントしかない | 起動直後に権限が確定していない / fetch に失敗した場合、ON のまま二度と再開しない |
| ② | フォアグラウンド復帰（`ContentView.swift:113` の `scenePhase == .active`）で記録の生死を確認していない | バックグラウンド中に更新が止まると、アプリを開き直しても止まったまま |
| ③ | 記録中に CLLocationManager が沈黙しても検知する仕組みが無い | `isRecording == true` のまま点が増えない |
| ④ | 表示は意思（`trip.isRecordingActive`）だけを見る（`TripDetailView.swift:157,217,324` / `ContentView.swift:337`） | 実際は止まっていても「記録中」と出るので気づけない |

**注意: 「点が増えない ＝ 故障」ではない。** `distanceFilter = 10`（`LocationRecorder.swift:126`）と
`LocationPointFilter` により、静止中は正常でも点は増えない。故障判定は点の増加ではなく
**`didUpdateLocations` の受信時刻**（フィルタで捨てた分も含む）で行う。

## 対応方針

状態を 2 つに分けて扱う。

- **意思 (intent)**: ユーザーが記録 ON にしたか ＝ `TripEntity.isRecordingActive`（永続。正本は今のまま）
- **実動 (actual)**: CLLocationManager が実際に更新を届けているか ＝ `LocationRecorder.isRecording` ＋ 最終受信時刻

「意思 ON なのに実動していない」ときにアプリが動く機会（起動・フォアグラウンド復帰・定期チェック・
権限変化）ごとに自動で戻す。

### Phase 1: 復帰の口を増やす（ensureRecording）

- `LocationRecorder.resumeIfNeeded()` を `ensureRecording()` に置き換える（呼び出し側も追従）
  - 意思 ON・未記録・権限あり → 再開（現行の `resume(trip:)`）
  - 意思 ON・権限 `.notDetermined` → `requestWhenInUseAuthorization()`。連打しないよう要求済みフラグを持つ
  - 意思 ON・権限 `.denied` / `.restricted` → `lastError` に既存文言を出すだけで自動開始はしない。
    **意思は消さない**ので、設定アプリで許可し直した瞬間に既存の権限変化経路で復帰する
- 記録中に権限を取り消されたときの扱いを変える。今は `stopRecording()` を呼ぶため意思まで消えて
  再開できなくなる（`LocationRecorder.swift:176`）。**意思を残したまま中断する** `suspendRecording()` を分け、
  「停止操作 ＝ 意思 OFF」「権限喪失 ＝ 中断だけ」にする
- 呼び出し箇所を追加する
  - `ContentView` の `scenePhase == .active`（`ContentView.swift:113`）
  - `ContentView` の `.task`（初回表示時）
  - 既存の `TripNoteApp.init` / 権限変化はそのまま
- 停止時の意思 OFF は現状どおり（`stopRecording()` が `isRecordingActive = false` にする）
- 意思 ON の trip が複数ある前提は取らない（現行どおり `fetchLimit = 1` で最初の 1 件）

### Phase 2: 沈黙の検知と自動再開（watchdog）

- `LocationRecorder` に `lastLocationUpdateAt` を持つ。`didUpdateLocations` を受けたら
  **`LocationPointFilter` で捨てた場合も**更新する。記録の開始・入れ直しの時点でも「今」を入れるので、
  記録中は nil にならない
  - 当初案の `UserDefaults` への保存は**やめた**。プロセスが変われば `isRecording` は必ず false ＝
    判定は `.resume` に決まるので、跨いで持ち越した値が結論を変えることが無い
- 判定は純関数 `Domain/RecordingWatchdog.swift`（新規）に置く。SwiftData も CLLocationManager も触らない

  ```swift
  enum RecordingWatchdog {
      enum Action: Equatable { case none, requestAuthorization, resume, restart, denied }
      struct Input {
          var isIntended: Bool          // trip.isRecordingActive
          var isRecording: Bool         // recorder.isRecording
          var authorization: CLAuthorizationStatus
          var lastUpdateAt: Date?       // didUpdateLocations の最終受信時刻
          var now: Date
      }
      static let staleThreshold: TimeInterval = 10 * 60
      static func decide(_ input: Input) -> Action
  }
  ```

  - 意思 OFF → `.none`
  - `.denied` / `.restricted` → `.denied`（自動開始しない）
  - `.notDetermined` → `.requestAuthorization`
  - 未記録 → `.resume`
  - 記録中 かつ `now - lastUpdateAt > staleThreshold`（`lastUpdateAt` が nil なら記録開始時刻から測る）→ `.restart`
  - それ以外 → `.none`
- `.restart` は `stopUpdatingLocation()` → `startUpdates()` の入れ直し。記録データも意思も変えない。
  入れ直した時点で `lastLocationUpdateAt = now` にしてクールダウンし、毎分 restart を繰り返さないようにする
- 閾値 10 分の根拠: 生きていれば静止中でも数分間隔で更新は届く。誤検知しても restart の害はほぼ無いので
  保守的に長めを取る
- フォアグラウンドの間だけ 60 秒周期で `ensureRecording()` を回す（Recorder 内の `Task` + `Task.sleep`。
  `scenePhase` で開始・停止する）
- **対象外**: `BGTaskScheduler` による背面チェック。バックグラウンドは「更新が来ている ＝ 生きている」で、
  来ない間はアプリ自身も動けない。保険としては既に
  `startMonitoringSignificantLocationChanges()`（`LocationRecorder.swift:134`）が入っている

### Phase 3: 「動いている」ことが見える表示（iOS のみ）

- `RecordingBarState.Detail` に `.stalled`（例: 「記録中（位置情報を再取得中）」）を追加し、
  `Input` に `isStalled` を足す。優先順は `error` > `stalled` > `recording`
  - 出すのは **restart しても戻らないとき**（閾値の 2 倍を超えたとき）だけ。普段は静かに直すので見た目は変えない
- 「記録中」タグ（`TripDetailView` の `statusTag` / `ContentView` の `TripCard`）と地図の
  `TripMapView(isActive:)` は意思ではなく **実動**（`recorder.isRecording && recorder.activeTrip?.id == trip.id`）を
  見るようにする。意思 ON でも未復帰の間は「進行中」に落ちる
- 旅行画面の RECORD 欄に「意思 ON だが実動していない」状態の行を足す
  （「記録の再開を待っています / 記録は ON のままです。位置情報が使えるようになると自動で再開します。」）。
  意思が消えていないことを見せて、ユーザーが開始し直さなくて済むようにする
- **Web は変更なし**: `isRecordingActive` はローカル専用フィールドで同期されず、Web に記録状態の表示は無い
  （`grep -rn 記録中 web/src` は 0 件）。GPS 記録は iOS 固有の操作なので、CLAUDE.md の
  「揃えるのは表示情報で、操作は別」に該当する

## 影響範囲

| Phase | iOS | Web |
| --- | --- | --- |
| 1 | `Services/LocationRecorder.swift`, `ContentView.swift` | なし |
| 2 | `Domain/RecordingWatchdog.swift`(新規), `Services/LocationRecorder.swift`, `ContentView.swift` | なし |
| 3 | `Domain/RecordingBarState.swift`, `Views/RecordingBar.swift`, `Views/TripDetailView.swift`, `ContentView.swift` | なし |

- スキーマ変更なし・API 契約（`docs/specs/server-api.md`）の変更なし・同期の挙動変更なし

## テスト方針

- `ios/TripNoteTests/RecordingWatchdogTests.swift`（新規）: `decide` の分岐を網羅する
  （意思 OFF / denied / notDetermined / 未記録 → resume / 沈黙 → restart / 正常 → none、閾値ちょうどの境界）
- `RecordingBarStateTests` に `.stalled` の分岐と優先順（error > stalled > recording）を追加
- `LocationRecorder` 本体は CLLocationManager 依存でユニットテストの対象外。判定ロジックを
  watchdog の純関数へ寄せることでテストを担保する。SwiftData のテスト制約（CLAUDE.md）に従い
  unmanaged なエンティティで書く
- 新規 Swift ファイルを足したら `xcodegen generate` を再実行してから
  `xcodebuild -project TripNote.xcodeproj -scheme TripNote -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test`
  （忘れると 0 件実行で成功扱いになる）
- 実機確認（背面の挙動はシミュレータで再現しない）
  1. 記録 ON → アプリを強制終了 → 起動し直して自動で再開する
  2. 記録 ON のままバックグラウンドで移動 → 復帰時に記録が続いている（地点数が増えている）
  3. 設定で位置情報を「許可しない」に変更 → バーにエラーが出て意思は残る → 「Appの使用中」に戻すと自動復帰
  4. シミュレータでは 1・3 と、閾値を一時的に短くした状態での `.restart` 発火まで確認する
