# Supabase スキーマ

trip-note のデータモデルはこのディレクトリのマイグレーション SQL を正とする。
Swift(`ios/TripNote/Models/`)/ TypeScript(`web/src/lib/types.ts`)の型はこれに合わせて手で定義する。

## セットアップ

1. https://supabase.com/dashboard でプロジェクトを作成する
2. `migrations/` の SQL をファイル名順に SQL Editor へ貼り付けて実行する
   (Supabase CLI を使う場合は `supabase link` 後に `supabase db push`)
3. 開発中はメール確認を無効にする:
   Authentication → Sign In / Up → Email → 「Confirm email」を OFF
4. クライアント側の接続設定
   - Web: `web/.env.example` をコピーして `web/.env.local` を作成し、
     Settings → API の Project URL / anon key を設定する
   - iOS: `ios/TripNote/Resources/Supabase.example.plist` をコピーして
     同じ場所に `Supabase.plist` を作成し、同じ値を設定する。
     その後 `cd ios && xcodegen generate` を再実行する

## テーブル

- `trips`: 旅行単位のグルーピング
- `location_points`: 位置情報(trip に紐づく)
- `media`: 写真・動画(Phase 4 で使用。スキーマのみ先行作成)

全テーブルで RLS を有効化しており、`user_id = auth.uid()` の行のみ読み書きできる。
`id` はクライアントが発行した UUID をそのまま使い、upsert で冪等に同期する。
