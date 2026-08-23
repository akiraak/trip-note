# Web の地図にプランのルート(道路形状)を表示する

## 目的・背景

道路ルーティング(OSRM プロキシ + `route_legs` キャッシュ)はサーバに実装済みだが
(`web/src/lib/routing.ts` / `POST /api/route`)、使っているのは iOS だけで、
Web の地図には**プランのルート線が 1 本も無い**(トップ地図は実績トラックのみ)。
`docs/plans/archive/plan-road-routes.md` で「Web のプランルート描画はスコープ外。
`/api/route` を使えばいつでも足せる状態にしておく」とした残りを実装する。

前提として日毎プランの地図(`docs/plans/web-day-plan-map.md`)が入っていること。
そこで引いた直線を道路形状に差し替え、トップ地図にはプランのルートを破線で追加する。

## 対応方針

### 前提: ブラウザから `/api/route` は叩かない

`/api/route` は `API_SHARED_SECRET` の Bearer が必要(iOS 向け契約)で、閲覧 UI は
Bearer を持たない。既存の Server Actions の規約(`trips/[id]/actions.ts` の冒頭コメント:
「ページと同じ保護範囲(本番は Cloudflare Access)で動くため Bearer 認証は使わない」)に
合わせ、**Server Action からサーバ内で `fetchRouteLegs()` を直接呼ぶ**。
シークレットはクライアントに出さず、`/api/*` の契約も変えない。

### Step 1: レグ組み立ての共通化 `src/lib/route-legs.ts`(新規・クライアント安全)

`routing.ts` は `node:net` と better-sqlite3 に依存するのでクライアントから import できない。
純ロジックだけを新モジュールに置き、iOS の `Domain/RouteLegs.swift` と同じ規約にする。

- 型: `RoutePoint` / `Leg = { from, to }` / `ResolvedLeg = { coordinates, distanceM, durationS }`
- `legKey(from, to)`: 小数 4 桁丸めの `"lat,lon>lat,lon"`。**`routing.ts` から移設**し、
  `routing.ts` はこれを import する(キー規約を 1 箇所に保つ。既存の再エクスポートで
  `test/routing.test.ts` と `/api/route` の挙動は不変)
- `buildLegs({ start, points })`: `RouteLegBuilder.legs` の移植。起点(前泊地)を先頭に
  差し込み、隣接ペアをレグ化し、丸め粒度で同一地点になる退化レグを除く
- `totalLegMeters(legs, resolved)`: `RouteLegDistance.totalMeters` の移植。
  解決済みは道路距離、未解決は Haversine(`lib/geo.ts`)でフォールバック

### Step 2: Server Action `src/app/trips/[id]/route-actions.ts`(新規)

- `resolveRouteLegsAction(legs)`:
  - 入力は `{ from, to }[]`。`MAX_LEGS_PER_REQUEST`(50)で上限を守り、越えたら切り詰める
  - `fetchRouteLegs()` を呼び、**`Record<legKey, ResolvedLeg>`** を返す
    (解決できなかったレグはキーごと欠落 = クライアントは直線フォールバック)
  - 表示専用なので `revalidatePath` はしない

### Step 3: クライアント側フック `src/app/trips/[id]/use-route-legs.ts`(新規)

- モジュールスコープの `Map<key, ResolvedLeg>` をキャッシュに使う
  (日別地図は遅延マウント/アンマウントするので、再マウントで取り直さないため)
  + 進行中の Promise をキーで共有して重複リクエストを防ぐ
- `useRouteLegs(legs)`: 未解決キーだけを **8 件ずつのチャンクで順に** action へ投げ、
  チャンクごとに state を更新する
  - OSRM はサーバ側で直列 + 最小 1 秒間隔なので、全件そろうまで待つと初回に数十秒
    何も変わらない。チャンク更新なら直線から順に道路形状へ差し替わる
- 返り値は `Record<key, ResolvedLeg>`。日別地図とトップ地図が同じフック/キャッシュを使うので、
  同じ区間を二重に取りに行かない

### Step 4: 描画

- **日別地図(`day-map.tsx`)**: レグごとに、解決済みなら道路の座標列、未解決なら
  `[from, to]` の直線を描く(実線 `#2563eb` 幅 3。iOS のミニ地図と同じ)
- **トップ地図(`trip-map.tsx`)**: プランのルートを追加する
  - 実績トラック(実線 幅 4)と区別するため**破線**(`line-dasharray: [2, 2]`、
    `#2563eb` の opacity 0.55、幅 3。iOS の `planRoute` と同じ意図)
  - **座標列は日付順で作る**: 現在 `page.tsx` が渡している `checkpointMarkers` は
    trip 全体を `sort_order, created_at` で並べたもので、日をまたぐ順序が保証されない。
    ルート用には `planDays`(日付順 → 日内 `sort_order` 順)から作った座標列を
    別 prop で渡す
  - 現状の `useEffect` は props が変わるたび地図ごと作り直すため、レグ解決のたびに
    再生成するとちらつく。**ルートのソースだけ `getSource(...).setData(...)` で更新**する
- **日カードのヘッダに走行距離**: `totalLegMeters` の結果を `formatDistance` で
  「約 12.3 km」と出す(未解決レグ混じり・OSRM 由来どちらも概算なので常に「約」。
  iOS の `plan-day-distance` と同じ)

### Step 5: サーバでのプリフィル

- `routing.ts` に `readCachedLegs(keys)`(**DB 参照のみ・OSRM を呼ばない**)を追加し、
  `page.tsx` でその旅行のレグ列のうちキャッシュ済みのものを初期値として渡す
- 2 回目以降(および iOS で先に見た旅行)は SSR 直後から道路形状で描け、
  Step 3 は未キャッシュ分だけ取りに行く

### Step 6: 仕様書の更新

- `docs/specs/phase3-map-display.md` に Web のプランルート(道路形状・直線フォールバック・
  破線 = プラン / 実線 = 実績)を追記
- `docs/specs/server-api.md` は変更なし(`/api/route` の契約は不変。Web は Server Action 経由)

## 影響範囲

- web(新規): `src/lib/route-legs.ts` / `src/app/trips/[id]/route-actions.ts` /
  `src/app/trips/[id]/use-route-legs.ts`
- web(変更): `src/lib/routing.ts`(`legKey` 移設・`readCachedLegs` 追加)/
  `trip-map.tsx` / `day-map.tsx` / `plan-section.tsx`(距離表示)/ `trips/[id]/page.tsx`
- iOS: 変更なし(レグキーの規約は不変。`route_legs` キャッシュを iOS と共有する)
- DB スキーマ・同期契約・env・compose: 変更なし。外部通信先も既存の OSRM のみ

## リスク・留意点

- OSRM デモサーバ依存。落ちている間は直線のまま表示され、壊れはしない(失敗はキャッシュしないので次回再試行)
- 初回表示は 1 レグ/秒でしか埋まらない。キャッシュは iOS と共有なので、iOS で見た旅行は即出る
- Server Action はページと同じ保護範囲(本番は Cloudflare Access、ローカル dev は無保護)。
  これは既存の編集用アクションと同じ前提

## テスト方針

- vitest: `route-legs.ts`
  - レグ組み立て(前泊地起点の差し込み・座標なしの除外・退化レグのスキップ・キーの丸め)
  - **途中挿入・並び替えで、変わった区間のキーだけが変わること**(キャッシュが効く前提の担保)
  - `totalLegMeters` の未解決フォールバック(Haversine)と解決済み(道路距離)の混在
  - 既存 `test/routing.test.ts`(`legKey` 移設後の回帰)
- `npm run lint` / `npm run build`
- 手動(`npm run dev`):
  - 道路形状で描かれること(直線 → 順次差し替わること)
  - `OSRM_ENDPOINT` を無効値にして直線フォールバックのままになること
  - チェックポイントを途中に追加してルートがそこを経由するよう更新されること
  - トップ地図で破線(プラン)と実線(実績トラック)が区別できること
  - 日カードの「約 N km」が更新されること
