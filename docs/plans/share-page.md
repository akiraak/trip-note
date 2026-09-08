# 旅行の工程と写真が見れる共有ページ（Web の共有リンク）

## 目的・背景

- 旅行の工程（プランの日別チェックポイント）と写真・動画を、旅ログを使っていない人にも見せたい
- 決定: **ログイン不要**。旅行ごとの共有リンク（推測できないトークン付き URL）を知っている人なら
  誰でも工程と写真を見られる形にする
- 本番の閲覧 UI は Cloudflare Access（Google ログイン）が唯一の認証なので、共有ページの経路だけを
  Access の Bypass にする。Bypass にする範囲は最小にし、その経路から書き込み操作ができないようにする

## 対応方針

### Phase 1: 共有トークン（発行・停止）

- `trips` に `share_token text` を足すマイグレーション（partial unique index）。サーバ専用の列で
  iOS には同期しない（`/api/sync` の push は列を明示、`/api/sync/pull` の select も列を明示しているので
  そのままで流れない。`updated_at` も動かさないので LWW にも影響しない）
- `web/src/lib/share.ts`: `issueShareToken(tripId)`（既にあれば同じものを返す）/ `revokeShareToken(tripId)` /
  `readSharedTrip(token)` / `readSharedMedia(token, mediaId)`。トークンは `randomBytes(18)` の base64url（24 文字）
- Web 旅行詳細のヘッダに「共有リンク」欄（`share-link.tsx`）: 未発行なら「共有リンクを発行」、発行済みなら
  URL 表示 + コピー + 「共有を停止」（二段階確認）。Server Action は `actions.ts` に追加

### Phase 2: 共有ページ `/share/[token]`

- `web/src/app/share/[token]/page.tsx`（server component）。トークン不一致・削除済み・停止済みは 404、
  `robots: noindex`
- 表示は Web 旅行詳細と同じ情報の閲覧専用版（編集導線・削除・AI 提案・終了は出さない）:
  - 地図（記録トラック・チェックポイントのピン・プランの破線ルート・写真マーカー）。`TripMap` を再利用し、
    写真マーカーのリンク先を共有用メディア配信に差し替える。**未解決レグの道路形状は取りに行かない**
    （SSR でキャッシュ済みの分だけ描き、残りは直線）— 公開経路から OSRM プロキシを叩かせないため
  - 旅行の情報（開始・終了・出発予定・目的地・地点数・総距離）
  - プラン: 日カード（N日目・日付(曜日)・出発時刻・約 走行距離・タイトル・経由地・メモ・チェックポイント
    〔種別の色点・名前・種別・予定時刻 or 到着予想「頃」・座標未設定・メモ・地図↗〕）。日の見出しで地図が寄る。
    空状態「プランはまだありません」「チェックポイントなし」も同じ文言
  - メディア: 撮影時刻の新しい順のグリッド。「写真・動画がありません」
- 共有用メディア配信 `GET /share/[token]/media/[id]`: そのトークンの旅行に属するメディアだけを配信する
  （`/media/[id]` は Access の Allow 配下のまま）。配信処理は `/media/[id]` と共通化（`lib/media-stream.ts`）

### Phase 3: 公開経路のガード

- Next.js の Server Action は「どのページの URL に POST しても action id で実行される」ため、`/share/*` を
  Access の Bypass にすると削除などの Server Action が無認証で叩けてしまう。`web/src/proxy.ts`
  （Next.js 16 の Proxy。旧 Middleware）で `/share/:path*` は **GET / HEAD 以外を 405** にする。
  判定は純関数 `lib/share-guard.ts` に置いてユニットテストする

### Phase 4: 仕様・運用手順

- `docs/specs/server-api.md` に `GET /share/[token]` と `GET /share/[token]/media/[id]`、`/share/*` の
  メソッド制限を追記
- `docs/specs/deploy-g3plus.md` と `../g3plus-ops/docs/workflows/trip-note.md` / `CLAUDE.md` に
  Cloudflare Access の 3 つ目のアプリ（`trip.chobi.me/share` → Bypass〔Everyone〕）を追記

### Phase 5: デプロイと公開確認（akiraak の手作業を含む）

- Cloudflare Access に `trip.chobi.me/share` の Bypass アプリを追加（手作業）→ g3plus で pull + rebuild →
  ログアウト状態（別ブラウザ）で共有リンクが開けること、`POST /share/<token>` が 405 になること、
  `/trips/*` は引き続きログインに飛ぶことを確認

## 影響範囲

- Web: `lib/db.ts`（マイグレーション）、`lib/types.ts`、`lib/share.ts`（新規）、`lib/media-stream.ts`（新規）、
  `app/media/[id]/route.ts`、`app/trips/[id]/{actions.ts,page.tsx,share-link.tsx,trip-map.tsx,use-route-legs.ts}`、
  `app/share/[token]/*`（新規）、`src/proxy.ts`（新規）
- iOS: 変更なし（共有リンクの発行・表示は Web のみ。iOS の旅行画面に共有リンクを出すのは派生タスクにする）
- 本番: Cloudflare Access のアプリ追加が必要（コード側のデプロイだけ先にしても、共有ページが Access の
  ログイン配下に入るだけで壊れない）

## テスト方針

- vitest（テスト毎の一時 DB）: トークンの形式と冪等な発行・停止、`updated_at` が動かないこと、
  `readSharedTrip` が不一致・削除済み・停止済みで null、tombstone の日・チェックポイント・メディアを含まないこと、
  `readSharedMedia` が他の旅行のメディアを返さないこと、`share-guard` のメソッド判定
- `npm run lint` / `npm run build`
- 開発サーバで `/share/<token>` が 200、`/share/<token>` への POST が 405、停止後に 404 になることを curl で確認

## 実施記録（2026-09-08）

Phase 1〜4 を実装。Phase 5（Cloudflare Access の手作業とデプロイ）が残っている。

- **Phase 1**: `trips.share_token`（partial unique index）を追加。`web/src/lib/share.ts` に
  発行 / 停止 / 読み出しを置き、旅行詳細に「共有リンク」欄（`share-link.tsx`）を足した。
  絶対 URL はリクエストの Host から server component で組む（クライアントで `window.location` を
  effect で読むと `react-hooks/set-state-in-effect` に掛かるため）
- **Phase 2**: `/share/[token]`（`page.tsx` + `share-canvas.tsx` + `share-plan.tsx`）と
  `/share/[token]/media/[id]`。地図は `TripMap` を再利用し、`mediaBasePath` と `resolveLegs` を
  props で足した。メディア配信（Range 対応）は `lib/media-stream.ts` に切り出して `/media/[id]` と共通化
- **Phase 3**: `web/src/proxy.ts`（Next.js 16 の Proxy。旧 Middleware）で `/share/*` の
  GET / HEAD 以外を 405。判定は `lib/share-guard.ts`
- **Phase 4**: `docs/specs/server-api.md`（認証・2 エンドポイント）、`docs/specs/deploy-g3plus.md`
  （Access 3 アプリ・疎通確認）、`../g3plus-ops/docs/workflows/trip-note.md` と同 `CLAUDE.md` を更新

検証:

- `npm test` 220 件 pass（`test/share.test.ts` / `test/share-guard.test.ts` を追加）、`npm run lint`、`npm run build` 通過
- 一時 DB の開発サーバ（:3099）で確認:
  - `/share/<token>` 200。1日目 / Sep 1 (火) / 出発 09:00 / 約 10.03 km / 松本城 / 座標未設定 /
    チェックポイントなし / 09:14 頃 が旅行詳細と同じ文言で出る。編集・削除・AI・終了の導線は出ない。
    `robots: noindex, nofollow`
  - メソッド: GET / HEAD 200、POST / PUT / DELETE / OPTIONS 405（`Allow: GET, HEAD`）。
    `/trips/*` と `/api/*` は Proxy の対象外で従来どおり
  - メディア: `/share/<token>/media/<id>` 200（Range で 206）、他の旅行・存在しない id は 404
  - 不正・停止済み・削除済みトークンは 404。停止後はメディアも 404
  - ブラウザで発行 → 共有ページ（地図の破線ルート・チェックポイントのピン・写真マーカー）→ 停止 →
    旧 URL が 404 まで通し確認。コンソールにエラーなし（レグ解決の Server Action を呼ばない）
  - 発行・停止で `trips.updated_at` は動かない

**Phase 5（残り。ユーザーの手作業を含む）**:

1. Cloudflare Zero Trust に Access アプリ `trip.chobi.me/share` を **Bypass（Everyone）** で追加する
   （akiraak の手作業。未設定でも壊れず、共有リンクが Access のログイン配下に入るだけ）
2. `git push` → g3plus で `cd /home/ubuntu/trip-note && git pull` →
   `docker compose --project-directory /home/ubuntu/g3plus-ops/trip-note up -d --build`
   （`share_token` のマイグレーションは起動時に自動適用）
3. ログアウト状態（別ブラウザ）で共有リンクが開けること、`POST /share/<token>` が 405、
   `/trips/*` は Access のログインに飛ぶことを確認
