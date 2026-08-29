# 旅行画面が固まって操作できないバグ（記録点の増加）

## 目的・背景

2026-08-29、旅行中（「五大湖」、記録点は 8/25 時点で 6,791・連日 400〜700km 走行で現在は数万点規模）に
**旅行画面を開いた直後に固まって操作できない。記録バーの撮影ボタンも反応しない**という報告。

サーバは外出先から更新できないため、**iOS アプリ側だけで対応する**（原因もアプリ側なのでそれで完結する）。

## 原因

旅行画面と一覧の SwiftUI body が `trip.points`（全記録点のリレーション）を直接読んでいる。

| 場所 | 読んでいるもの | 1 回あたりのコスト |
| --- | --- | --- |
| `TripDetailView.segments` | `trip.sortedPoints` → `TrackSegmenter.split` | 全点フォールト + O(N log N) 並べ替え |
| `TripDetailView.statsRow` | `trip.points.count` + `trip.totalDistanceMeters` | **もう 1 回** O(N log N) + O(N) 距離計算 |
| `TripMapView` | segments 全点の `MapPolyline` + `displayedCoordinates` | 数万座標の地図再構築 |
| 一覧の `TripCard` | `thumbnailRoute`(並べ替え) + `totalDistanceMeters`(並べ替え) + `points.count` | 旅行ごとに同上 |

記録中は GPS 点の挿入（`distanceFilter = 10m` ≒ 運転中ほぼ毎秒）のたびに `trip.points` が変わり、
これを読む view が毎秒無効化 → 上記の全コストが**毎秒 main スレッドで走る**。
N が数千のうちは目立たなかったが、数万点で main スレッドが飽和し、タッチも処理されなくなった。
一覧は NavigationStack の根として生き続けるので、旅行画面を開いている間も裏で同じ再計算をしている（二重負荷)。

画面を開いた直後に固まるのは、初回の全点フォールト + 並べ替え×2 + 地図構築がそのまま main で走るため。

## 対応方針（iOS のみ）

**view の body から `trip.points` を読むのをやめ、バックグラウンドで固めたスナップショットを描く。**

1. **`TrackSnapshot`（Domain・純ロジック）**: 記録点の値型スナップショット
   - `segments`（時間ギャップ分割済み・**描画用に間引き済み**の座標列）/ `pointCount` / `distanceMeters`
   - 間引きは全区間合計で上限（旅行画面 2,000 点・一覧サムネイル 80 点)。各区間の首尾は必ず残す
     （開始・現在マーカーと区間の形を保つ）。純関数なのでユニットテスト対象
2. **`TrackLoader`（Services）**: バックグラウンド `ModelContext`（同じ container から生成）で
   `FetchDescriptor`（trip.id で絞り、`recordedAt` は SQL でソート）→ 値型に写して `TrackSnapshot.make`。
   main スレッドでは SwiftData に触らない
3. **`TripDetailView`**: `@State var track: TrackSnapshot` を持ち、`.task(id: 更新キー)` で読み直す
   - 更新キー = 記録中は `recorder.recordedPointCount / 100`（≒ 1km ごとに地図を追従）、非記録中は開いたとき 1 回
   - 統計の地点数・総距離は、記録中は `LocationRecorder` の増分値（毎秒更新・O(1)）、それ以外はスナップショット値
   - 空表示の判定はスナップショット読み込み完了後に行う（開いた瞬間の「地点がありません」のチラつき防止）
4. **`TripMapView`**: 中身が空 → 非空になったら初期カメラを当て直す（スナップショットが後から届くため)
5. **一覧の `TripCard`**: 同じスナップショット（上限 80 点）を `.task` で読み、`RouteThumbnail`・地点数・距離に使う。
   記録が無い旅行のプラン座標フォールバックは従来どおり同期読み（チェックポイントは数十件で軽い）
6. **`LocationRecorder.resume`**: `sortedPoints` + `totalDistanceMeters` の 2 回並べ替えを、
   SQL ソートの 1 回のフェッチにまとめる（記録開始・自動復帰時の引っかかり軽減）
7. **地図のメディアサムネイル**: `UIImage(contentsOfFile:)` を描画のたびに読んでいるのを NSCache で 1 回に

## 影響範囲

- iOS のみ: `Domain/TrackSnapshot.swift`（新規）、`Services/TrackLoader.swift`（新規）、
  `Views/TripDetailView.swift`、`Views/TripMapView.swift`、`ContentView.swift`、`Views/RouteThumbnail.swift`、
  `Services/LocationRecorder.swift`
- Web・サーバ・同期プロトコルには触れない
- 表示情報は変えない（iOS/Web の情報対応はそのまま）。変わるのは「地図の軌跡が最大 ≒1km 粒度で追従する」ことと
  「軌跡の描画点数に上限が付く」ことだけ

## テスト方針

- `TrackSnapshot` のユニットテスト（unmanaged・値型のみ）: 間引きの上限・首尾の保存・区間分割との組み合わせ・
  距離と件数がずれないこと
- 既存の全テスト + ビルドが通ること
- 実機（`./run-ios-device.sh`）で: 旅行画面を開いて即座に操作できること・撮影ボタンが反応すること・
  記録中に地図と統計が追従すること

## 実施記録（2026-08-29）

- 対応方針 1〜7 をすべて実装した。新規: `Domain/TrackSnapshot.swift` / `Services/TrackLoader.swift` /
  `TripNoteTests/TrackSnapshotTests.swift`（6 件）
- view の body から `trip.points` を読む箇所はゼロになった（残る `sortedPoints` は
  SyncEngine.relinkMedia と MediaImporter の取り込み時のみ = 毎秒は走らない）
- テスト 224 件（27 スイート）すべて通過・シミュレータビルド成功
- 残: 実機確認（`./run-ios-device.sh`。旅行中のため要 USB 接続）

## 未対応・様子見

- `SyncEngine` の push はバッチ 500 点ごとに main actor で変換している。今回の凍結の主因ではないので触らない
- それでも重い場合の次の一手: TripDetailView が読む `recorder.recordedPointCount` を小さな子 view に隔離して
  毎秒の無効化自体を局所化する
