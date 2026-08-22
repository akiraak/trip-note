# 旅行の削除

## 目的・背景

旅行(trips)を削除する手段が iOS / Web のどちらにも無い。
日・チェックポイントと同じ tombstone 方式で削除できるようにする。

## 対応方針

- **tombstone 削除**(`deleted_at`)。既存の双方向同期(LWW)にそのまま乗る
  (trips の deleted_at は sync / pull / 表示フィルタとも実装済み)
- **道連れ**: 未削除の trip_days / checkpoints も tombstone する
  (`deleteTripDay` と同じ規則。既に削除済みの行は触らず updated_at を進めない)。
  location_points / media は不変で tombstone カラムを持たないため行は残す
  (親 trip の tombstone で非表示になる。メディアファイルの物理削除もしない)
- **iOS**: `PlanEditor.delete(_ trip:)` を追加(純ロジック、unmanaged でテスト)。
  `TripDetailView` に「旅行を削除」ボタン + confirmationDialog。
  この旅行を記録中なら記録を停止してから削除し、保存 → sync → 一覧へ戻る。
  一覧・記録再開の fetch は `deletedAt == nil` フィルタ済みなので追加対応不要
- **Web**: `plan.deleteTrip` + `deleteTripAction`(`/` と `/trips/[id]` を revalidate)。
  旅行詳細ページ下部に二段階削除の client component(`delete-trip.tsx`。
  plan-section の削除 UI と同じ作法)。成功したら `/` へ遷移

## 影響範囲

- iOS: `PlanEditor.swift`、`TripDetailView.swift`
- web: `lib/plan.ts`、`trips/[id]/actions.ts`、`trips/[id]/delete-trip.tsx`(新規)、
  `trips/[id]/page.tsx`
- DB・同期・API: 変更なし(既存の tombstone 同期に乗る)

## テスト方針

- iOS: `PlanEditorTests` — delete(trip) が trip / 日 / チェックポイントを tombstone し、
  削除済みの子は触らない(updatedAt 不変)、isRecordingActive が下りる
- web: `plan.test.ts` — deleteTrip の道連れ tombstone と updated_at、
  削除済み trip への操作が「旅行が見つかりません」になること
- 手動: iOS で削除 → 一覧から消える → Web からも消える(同期)
