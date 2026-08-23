# TODO

- 旅行画面の既存の予定にさらに場所と出発時間を入れてプランを追加する
  例:シアトルからシカゴまでのプランを作成済み。そこにシアトルまで帰るプランを追加する

- Web の地図にプランのルート(道路形状)を表示する [plan](docs/plans/web-plan-route.md)
  - [ ] Step 1: レグ組み立ての共通化 `lib/route-legs.ts`(`legKey` 移設)
  - [ ] Step 2: Server Action `resolveRouteLegsAction`
  - [ ] Step 3: クライアントフック `use-route-legs.ts`(チャンク解決 + キャッシュ)
  - [ ] Step 4: 日別地図の道路形状 / トップ地図の破線プランルート / 日毎の距離表示
  - [ ] Step 5: サーバでのプリフィル(`readCachedLegs`)
  - [ ] Step 6: `docs/specs/phase3-map-display.md` の更新

- チェックポイントに追加しても地図に表示されない
- デザインを変更するios
- デザインを変更するPC-Web,Mobile-Web