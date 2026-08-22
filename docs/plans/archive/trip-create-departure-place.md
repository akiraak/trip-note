# 旅行作成に出発地を追加(現在地から設定可能)

## 目的・背景

旅行作成フォームには出発日時・目的地はあるが出発地が無く、AI の日数・宿泊地候補も
出発地なしで見積もっている。出発地を入力できるようにし、ワンタップで現在地から
設定できるようにする。

## 対応方針

- **データモデルは変更しない**。出発地は既存方針どおり
  **1 日目の `type = departure` チェックポイント**として保存する
  (名前 + 現在地から設定した場合は座標、`planned_time` = 出発日時)
- `PlanEditor.makeTrip` に出発地(`DeparturePlace`: 名前・座標)を渡せるようにし、
  trip + 1 日目 + departure チェックポイントを返す(挿入は呼び出し側)
- 現在地取得は新サービス `Services/OneShotLocationProvider.swift`:
  `CLLocationManager.requestLocation()` の async ラッパ(未許可なら許可ダイアログ、
  拒否済みはエラー)+ `CLGeocoder` の逆ジオコーディングで地名にする。
  記録用の `LocationRecorder` とは独立(記録設定・状態に影響しない)
- フォーム UI: 出発地 TextField + 「現在地」ボタン。現在地で自動入力した名前を
  ユーザーが編集した場合は座標を使わない(名前と座標の不整合を防ぐ。
  判定は作成時に「自動入力した名前のまま同じか」で行う)
- AI 候補出し `/api/ai/trip-outline` の入力に `departure`(任意)を追加して
  プロンプトに含める(初日に移動できる範囲の見積り精度向上)。
  iOS は 1 日目の departure チェックポイント名を送る
- `AIPlanSuggestView`(行程提案)の出発地初期値も departure チェックポイントから入れる

## 影響範囲

- iOS: `PlanEditor.makeTrip`(返り値に checkpoints 追加)、`TripCreateView`、
  `AIRecords.swift`(`AITripOutlineRequest.departure`)、`AIPlanSuggestView`、
  `Services/OneShotLocationProvider.swift`(**新規ファイル → xcodegen 再実行**)
- web: `lib/ai.ts`(`TripOutlineInput.departure` + プロンプト)、
  `docs/specs/server-api.md`、`web/test/ai.test.ts`
- DB・同期: 変更なし(既存の checkpoints をそのまま使う)

## テスト方針

- iOS: `PlanEditorTests`(makeTrip が departure CP を作る: 座標あり / なし / 出発地なし)、
  `AIRecordsTests`(リクエストの departure キー)。unmanaged エンティティで検証
- web: `parseTripOutlineInput` の departure(省略可)、`buildTripOutlinePrompt` に含まれること
- 現在地取得・逆ジオコーディングは手動確認(シミュレータの位置シミュレーション)
