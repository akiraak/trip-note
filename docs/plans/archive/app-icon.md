# アイコンの設定

## 目的・背景

アプリアイコンが未設定(iOS はデフォルトの空アイコン、Web は Next.js 既定の favicon)。
用意した画像(`~/Downloads/trip-icon.png`、1254×1254 PNG・アルファなし)を
iOS アプリと Web の両方に設定する。

## 対応方針

- 元画像はリポジトリに保存する(`docs/assets/app-icon-original.png`)
- **iOS**: `ios/TripNote/Resources/Assets.xcassets/AppIcon.appiconset/` を新規作成し、
  1024×1024 に縮小した PNG を single-size(iOS 17+ / Xcode 14+ 形式)で配置。
  `project.yml` の TripNote ターゲットに
  `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` を追加 → `xcodegen generate` 再実行
- **Web**(Next.js App Router のメタデータファイル規約):
  - `web/src/app/favicon.ico` を差し替え(32/16 のマルチサイズ ICO。PIL で生成)
  - `web/src/app/icon.png`(512×512)と `web/src/app/apple-icon.png`(180×180)を追加
- 画像処理は sips(縮小)+ PIL(ICO 生成)

## 影響範囲

- ios: `Resources/Assets.xcassets`(新規)、`project.yml`
- web: `src/app/favicon.ico` / `icon.png` / `apple-icon.png`
- docs: `docs/assets/app-icon-original.png`(新規)
- コードロジックの変更なし

## テスト方針

- iOS: シミュレータビルドが通ること(アセットカタログのコンパイル確認)。
  アイコンの見た目はシミュレータ / 実機のホーム画面で手動確認
- web: `npm run build` が通ること。favicon はブラウザで手動確認
