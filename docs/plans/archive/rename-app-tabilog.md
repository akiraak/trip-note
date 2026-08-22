# アプリ名を「旅ログ」に変更

## 目的・背景

ユーザーに見えるアプリ名を「旅ログ」にする(TODO 項目)。
リポジトリ名・ターゲット名・bundle id(com.akiraak.TripNote)などの内部識別子は
変更しない(変えるとプロビジョニングや同期先の識別に影響するため表示名のみ)。

## 対応方針

ユーザー可視の 4 箇所を「旅ログ」へ変更する。

1. `ios/project.yml` — `CFBundleDisplayName: TripNote` → `旅ログ`(ホーム画面の表示名)。
   変更後に `xcodegen generate` で Info.plist を再生成する
2. `ios/TripNote/ContentView.swift` — `.navigationTitle("trip-note")` → `"旅ログ"`
3. `web/src/app/layout.tsx` — `metadata.title: "trip-note"` → `"旅ログ"`(ブラウザタブ)
4. `web/src/app/header.tsx` — ヘッダのロゴテキスト `trip-note` → `旅ログ`

## 影響範囲

- 表示のみ。データモデル・API・デプロイ設定・bundle id は不変
- Info.plist は xcodegen が project.yml から再生成する(手編集しない)

## テスト方針

- iOS: `xcodegen generate` → シミュレータビルドが通ること。Info.plist の
  CFBundleDisplayName が「旅ログ」になっていることを確認
- Web: `npm run lint` / `npm run build` の通過(表示文字列のみなのでテスト追加はしない)
