# TODO

- 旅行画面の既存の予定にさらに場所と出発時間を入れてプランを追加する [plan](docs/plans/plan-extension.md)
  例:シアトルからシカゴまでのプランを作成済み。そこにシアトルまで帰るプランを追加する
  - [x] Phase 1: 採用の起点・到着地名を引数化(web lib/plan.ts + iOS PlanEditor)+ テスト
  - [x] Phase 2: iOS の導線(候補セクションの切り出し + 入力シート + 旅行詳細のボタン)
  - [x] Phase 3: Web の導線(trip-outline-step.tsx の共有化 + plan-section.tsx の入力フォーム)
  - [x] Phase 4: 「AI で行程を提案」(/api/ai/plan)の削除(iOS / web / server-api.md)
  - [ ] Phase 5: lint / build / 全テストは通過。**AI を実際に呼ぶ 1 往復の確認が残り**
    (既存プランのある旅行に目的地と出発日時を入れて候補を出し、採用した日程が
    最終日の続きとして並ぶこと。iOS 実機 / Web の両方)
