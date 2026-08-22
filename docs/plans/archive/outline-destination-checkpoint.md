# AI 候補の採用時に最終日へ目的地チェックポイントを作る

## 目的・背景

4泊5日の候補を採用すると、宿泊チェックポイントは 1〜4 日目にしか入らず、
最終日(5 日目)はチェックポイントが 0 件になり地図が表示されない。
データモデルの設計では「到着予定地は最終日の type = destination の
チェックポイント」なので、採用時にそれを作れば最終日の地図
(前泊地 → 目的地のルート)が自然に出る。

## 対応方針

- **サーバ**: trip-outline の応答に目的地の概算座標
  (`destinationLatitude` / `destinationLongitude`。候補共通なのでトップレベル)を追加。
  パースは既存の概算座標と同じ扱い(不正・片方だけは null)
- **iOS 採用ロジック** `PlanEditor.adopt(candidate:)`:
  - trip.destination が入っていれば、**最終日に type = destination の
    チェックポイント**(名前 = 目的地、概算座標付き)を追加する
  - 同日の並び順は「到着 → 宿泊」になるよう、日付ごとの採番を dict で管理する
    (unmanaged の新規日では nextSortOrder が逆参照を見られないため)
- **候補プレビュー地図**: 出発地 + 各泊に加えて**目的地のピン**も表示する
  (OutlineMapPoint を種別 enum にして departure / night / destination で
  アイコン・色を分ける)
- 既存の行程提案(/api/ai/plan)は最終日に destination を入れる指示が
  既にあるため変更なし

## 影響範囲

- web: `lib/ai.ts`(スキーマ・型・パース・プロンプト)、`docs/specs/server-api.md`
  → **サーバデプロイあり**
- iOS: `AIRecords.swift`、`PlanEditor.swift`、`TripCreateView.swift`
- DB・同期: 変更なし

## テスト方針

- web: 目的地座標のパース(正常 / 不正→null)
- iOS: adopt(candidate) が最終日に destination CP を作る(座標付き / destination
  未設定なら作らない / 同日に宿泊がある場合は到着 → 宿泊の順)
- 手動: 4泊5日を採用して 5 日目の地図(前泊 → 目的地)が出ること
