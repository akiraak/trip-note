# 移動手段を車に固定

## 目的・背景

移動手段は実際には車しか使わないため、選択 UI を無くして常に「車」として扱う。

## 対応方針

- **データモデル・同期・API は変更しない**(`trips.transport` は残し、常に `"car"` を入れる。
  サーバ・Web の transport 受け渡しの仕組みもそのまま)
- iOS:
  - `TripCreateView`: 移動手段ピッカーを削除し、作成時は常に `Transport.car`
  - `TripEditView`: ピッカーを削除。保存時に `transport = "car"` へ正規化
    (過去の旅行も編集のたびに car へ収束させる)
  - `TripDetailView` / `AIPlanSuggestView`: 移動手段の表示行を削除
    (固定値の表示は冗長)。AI リクエストは `trip.transport ?? "car"` を送る
  - `TransportPicker` struct を削除。`Transport` enum 自体は残す(定数として使用)
- Web:
  - 旅行詳細の「移動手段」表示セルを削除
  - AI 行程提案へ渡す transport は `trip.transport ?? "car"`(古い旅行の null 対策)

## 影響範囲

- iOS: `TripCreateView.swift` / `TripDetailView.swift` / `AIPlanSuggestView.swift`
- web: `trips/[id]/page.tsx`
- DB・同期・API・AI プロンプト: 変更なし

## テスト方針

- ロジック変更が無いため既存テストの回帰確認(iOS ユニットテスト + web vitest / lint / build)
- 手動: 作成フォームにピッカーが無いこと、AI 候補・行程提案が car 前提で出ること
