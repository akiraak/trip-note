# TODO

- チェックポイントからgoogle mapに転送してナビをさせる
- 目的地を地図上から選択可能に
- [ ] 現在日毎のプランは出発地点と目的地が直線で結ばれているけど、車で走る道の詳細がわかるようにする [plan](docs/plans/plan-road-routes.md)
  - [ ] Phase 1: サーバ — `route_legs` キャッシュ + `lib/routing.ts`(OSRM プロキシ)+ `POST /api/route` + vitest
  - [ ] Phase 2: iOS — RouteClient + レグ組み立て純関数 + ミニ地図/トップ地図/日詳細を道路ルート表示に(直線フォールバック)
  - [ ] Phase 3: 仕様書更新(server-api.md / phase3-map-display.md)+ 検証

