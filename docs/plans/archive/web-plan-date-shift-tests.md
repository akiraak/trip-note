# Web のプラン日付テストを新仕様に追従させる

## 目的・背景

`web/test/plan.test.ts` の「プランの日付は動かさない(1 日目の日付は作成時に決まる)」が赤いまま残っている。

- 80f6032「出発日を変えたらプランの各日付も動かす」で `web/src/lib/plan.ts` の `updateTrip` が
  出発日の変更にプランを追従させるようになったが、同コミットは Web のテストを更新していない
  （iOS 側は同コミットで `PlanEditorTests.swift` を更新済み）
- さらに 19a6134「出発日を変えたら 1 日目をその日にそろえる」で規則が
  「旧出発日 → 新出発日の差」から「1 日目が新しい出発日になるようにそろえる」へ変わったが、
  ここでも Web のテストは追従していない（`plan-dates.ts` のみ変更）

現状の Web テスト: 192 件中 1 件失敗（この 1 件だけ）。
加えて `departureShiftDays` / `planShiftNotice` / `shiftAllDays` に対する Web 側のテストは 0 件で、
iOS の `PlanEditorTests`（8 ケース）と非対称になっている。

## 対応方針

1. **旧テストの差し替え**: `web/test/plan.test.ts` の `updateTrip` describe にある
   「プランの日付は動かさない」を削除し、新仕様のテストに置き換える
   - 出発日を変えたら 1 日目がその日にそろい、2 日目以降も同じ日数動く（間隔は保つ）
   - 動いた日のチェックポイントの `planned_time` も同じ日数動く（壁時計の時刻は保つ）
   - 動いた行だけ `updated_at` が進む（LWW で他方の編集を潰さないため）
   - 時刻だけの変更 / 出発日の削除 / 日が無い場合は動かさず `updated_at` も据え置き
2. **`web/test/plan-dates.test.ts` を新設**: DB に触らない純関数
   （`dayDifference` / `departureShiftDays` / `planShiftNotice`）を iOS の
   `PlanEditorTests` と対応する形でテストする

## 影響範囲

- テストのみ。`web/src/` の実装は変更しない（実装は 19a6134 時点で正しい）
- 対応する iOS 側: `ios/TripNoteTests/PlanEditorTests.swift`（既に新仕様のテストあり。変更不要）

## テスト方針

- `cd web && npx vitest run` が全件緑になること
- iOS 側は変更しないので再実行不要（必要なら `plan-dates.ts` と `PlanEditor.swift` の規則が
  同じであることをテストのケース対応で示す）
