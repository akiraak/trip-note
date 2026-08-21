# Phase 2: Supabase 同期と記録の閲覧(iOS・Web) 詳細仕様

親プラン: [basic-features](../plans/basic-features.md)

## 目的

Phase 1 で iOS ローカル(SwiftData)に記録した trip / 位置情報を Supabase に同期し、
iOS と Web の両方で記録を閲覧できるようにする。

## 認証

- Supabase Auth のメール + パスワード認証を採用(iOS / Web 共通)
- ソーシャルログイン(Sign in with Apple 等)は後続タスク
- 開発中は Supabase ダッシュボードで「Confirm email」を無効にするとメール確認なしで使える
  (有効のままの場合、サインアップ後に確認メールのリンクを踏むまでログイン不可)

## スキーマ(`supabase/migrations/`)

`supabase/migrations/*_init.sql` を正とする。3 テーブルとも RLS を有効化し、
`user_id = auth.uid()` の行のみ select / insert / update / delete を許可する。

- `trips`: id (uuid, クライアント発行), user_id (default `auth.uid()`), title, started_at, ended_at, created_at, updated_at
- `location_points`: id, trip_id (FK cascade), user_id, latitude, longitude, altitude, accuracy, recorded_at
- `media`: Phase 4 用に先行作成。id, trip_id, location_point_id (FK set null), user_id, type (enum photo/video), storage_path, taken_at

id はクライアント(iOS)が発行した UUID をそのまま使い、upsert で冪等に同期する。

## iOS 同期設計

### 接続設定

- `ios/TripNote/Resources/Supabase.plist`(gitignore 済み)に `SUPABASE_URL` / `SUPABASE_ANON_KEY` を置く
- 雛形は `Supabase.example.plist` をコミット。plist 追加後は `xcodegen generate` の再実行が必要
- plist が無い場合はアプリは従来どおり動作し、同期セクションに未設定の旨を表示する

### 同期方式(アップロードキュー)

- `TripEntity` / `LocationPointEntity` に `needsSync: Bool = true` を追加
  (デフォルト true なので既存ローカルデータも初回同期で全件アップロードされる)
- trip のメタデータが変わる操作(作成・記録停止)で `needsSync = true` に戻す
- `SyncEngine.syncNow()`:
  1. `needsSync == true` の trip を全件 upsert → 成功したら `needsSync = false`
  2. `needsSync == true` の点を `recordedAt` 順に 500 件ずつ upsert → 成功したバッチから `needsSync = false`
- 記録中はローカル優先: 自動同期(フォアグラウンド復帰時)は記録中はスキップする。
  記録停止時と手動「今すぐ同期」ではいつでも同期できる(点は不変・trip は upsert なので冪等)
- 未ログイン / plist 未設定時は同期しない(UI に状態表示)

### 閲覧画面(iOS)

- trip 一覧(既存)から `TripDetailView` へ遷移
- 詳細: タイトル・期間・総距離・地点数のヘッダ + 位置情報のタイムライン(時刻・緯度経度・高度・精度)

## Web 設計(Next.js 16)

- `@supabase/supabase-js` + `@supabase/ssr`(cookie ベースのセッション)
- Next.js 16 では middleware ではなく `src/proxy.ts` を使う(セッションリフレッシュ + 未ログインを `/login` へリダイレクト)
- ページ構成(すべて Server Component + Server Actions、閲覧は RLS により自分の行のみ):
  - `/login`: ログイン / 新規登録フォーム(Server Actions)
  - `/`: trip 一覧(タイトル・期間・地点数)
  - `/trips/[id]`: 詳細。総距離(haversine を `src/lib/geo.ts` に実装)+ タイムライン
- env は `web/.env.local`(`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

## テスト方針

- iOS: DTO マッピング(entity → snake_case レコード)、バッチ分割(`chunked`)、
  同期対象の抽出ロジックをユニットテストに追加。`xcodebuild test` で全件パス
- Web: `npm run lint` + `npm run build`(env 未設定でもビルドが通ること)
- 実機 / ブラウザでの E2E 確認は Supabase プロジェクト作成後に手動で行う(下記)

## 手動セットアップ手順(要ユーザー操作)

1. https://supabase.com/dashboard でプロジェクト作成
2. `supabase/migrations/` の SQL を SQL Editor で実行(または `supabase db push`)
3. Authentication → Sign In / Up → Email で「Confirm email」を無効化(開発中)
4. `web/.env.example` を元に `web/.env.local` を作成
5. `ios/TripNote/Resources/Supabase.example.plist` をコピーして `Supabase.plist` を作成し、`xcodegen generate` を再実行
