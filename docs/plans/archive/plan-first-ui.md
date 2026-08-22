# プラン表示の UI 再構成(記録開始の移動・候補地図・プラン優先表示)

## 目的・背景

現状は一覧画面に「記録を開始」があり(どの旅行に記録されるか分かりにくい)、
旅行作成後は一覧に戻り、AI 候補は文字だけ、旅行詳細は記録の地図・統計が先で
プランが下の方にある。プラン中心の使い方に合わせて再構成する。

1. 「記録を開始」は旅行の中に表示
2. 「旅行の新規作成」の後は旅行の中を表示
3. 旅行作成時の AI 候補それぞれに候補の地図を表示
4. 旅行画面の一番上はプラン(地図 + チェックポイントの概要)
5. 日詳細(プラン)にも地図を表示

## 対応方針

### 1. 記録開始を旅行の中へ(LocationRecorder の API 変更)

- `LocationRecorder.startRecording(trip:)` を新設し、**指定した旅行に**記録する
  (従来の「進行中/プラン中の旅行を自動選択 or 自動作成」= `beginOrResumeTrip` は廃止。
  「YYYY-MM-DD の旅行」の自動作成も無くなる)
- `ContentView` の記録セクション(開始/停止・記録中表示・カメラ)を削除し、
  `TripDetailView` に「記録」セクションとして移設。この旅行を記録中なら
  記録中表示 + 撮影 + 停止、未記録なら「記録を開始」、別の旅行を記録中ならその旨を表示。
  終了済み旅行(endedAt あり)にはセクションを出さない
- クラッシュ後の自動再開(`resumeIfNeeded`)は従来通り

### 2. 作成後に旅行の中へ

- `ContentView` を `NavigationStack(path:)` にし、`TripCreateView` に
  `onCreated: (TripEntity) -> Void` を追加。シートの onDismiss で作成済み旅行を
  path に push する(AI 候補のスキップ・採用・目的地なしのどの閉じ方でも遷移)

### 3. AI 候補ごとの地図

- **サーバ**: trip-outline の nights に概算座標(`latitude` / `longitude`)を追加。
  **候補プレビュー地図専用**で、採用時のチェックポイントには保存しない
  (「AI の座標は信用しない」方針は維持。地図はおおよその位置でよい)。
  範囲外・非数値はパースで null に落とす
- **iOS**: 候補を Section 単位の表示に変え、タイトル・概要・ミニ地図
  (出発地 + 各泊のマーカーとポリライン、操作不可)+「この候補を採用」ボタン

### 4. 旅行画面はプラン優先

- `TripDetailView` の並びを「地図 → プラン(日別 + チェックポイント概要)→ 記録 →
  基本情報 → 旅行を終了 → メディア → タイムライン → 旅行を削除」に変更
- 日別行(`TripDayRow`)の「チェックポイント n 件」を、
  チェックポイント名を「→」で繋いだ概要表示に変更

### 5. 日詳細にも地図

- `TripDayDetailView` の先頭に、その日の座標ありチェックポイントの地図を表示
  (`TripMapView` を segments 空で再利用)

## 影響範囲

- iOS: `LocationRecorder.swift` / `ContentView.swift` / `TripDetailView.swift` /
  `TripDayDetailView.swift` / `TripCreateView.swift` / `AIRecords.swift`
- web: `lib/ai.ts`(nights スキーマ・パース)、`docs/specs/server-api.md`、`web/test/ai.test.ts`
- DB・同期: 変更なし

## テスト方針

- web: nights の座標パース(正常 / 範囲外→null / 旧応答に無し→null)
- iOS: `AIRecordsTests`(nights 座標のデコード、無しは nil)。
  既存テストの回帰(LocationRecorder は実機依存のためユニットテスト対象外のまま)
- 手動: 作成→旅行詳細へ遷移、候補地図の表示、旅行内での記録開始/停止、日詳細の地図
