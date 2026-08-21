# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

trip-note は旅行のサポートをするアプリで、モバイルと Web の両方で使うことを想定している。

## アーキテクチャ

ネイティブ構成。モバイルは iOS (Swift/SwiftUI) 先行で、Android (Kotlin) は後続タスク。

- `ios/`: iOS アプリ (Swift/SwiftUI, iOS 17+)。Xcode プロジェクトは XcodeGen (`ios/project.yml`) で生成するため `.xcodeproj` はコミットしない。Supabase は supabase-swift (SPM)。地図は MapKit を採用予定
- `web/`: Next.js (TypeScript + Tailwind + App Router)。Supabase は supabase-js。地図は MapLibre GL JS を採用予定
- バックエンドは Supabase (Postgres + Auth + Storage)。データモデル（trips / location_points / media）は Supabase スキーマを正とし、Swift / TypeScript 双方に型を定義する
- Swift 側のドメインモデルは `ios/TripNote/Models/`、ロジックは `ios/TripNote/Domain/`

## コマンド

### iOS (`ios/`)

```bash
cd ios
xcodegen generate      # project.yml から TripNote.xcodeproj を生成（project.yml 変更時・クローン直後に実行）
open TripNote.xcodeproj
# CLI ビルド
xcodebuild -project TripNote.xcodeproj -scheme TripNote -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
# テスト
xcodebuild -project TripNote.xcodeproj -scheme TripNote -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

実機で動かす場合はリポジトリルートの `./run-ios-device.sh` を使う（ビルド → devicectl でインストール → 起動まで行う。iPhone は USB 接続 + ロック解除 + デベロッパモード有効が前提）。署名チームは `DEVELOPMENT_TEAM` 環境変数で差し替え可能（既定: N38G4DGA67）。

- 単一テストの実行: 上記 test コマンドに `-only-testing:TripNoteTests/GeoTests` を付ける（クラス/メソッド単位で絞り込み可）

### Web (`web/`)

```bash
cd web
npm install
npm run dev            # 開発サーバ (http://localhost:3000)
npm run lint           # ESLint
npm run build          # 本番ビルド（型チェック込み）
```

<!-- vibeboard:begin -->

## 開発管理画面 (vibeboard)

ローカル開発時のタスク・プラン管理は [vibeboard](https://github.com/akiraak/vibeboard) で行う。
プロジェクト直下に degit で vendor してある（`./vibeboard/`）。

```bash
# 親プロジェクト直下から
node vibeboard/dist/cli.js --root .
```

`http://localhost:3010` でプロジェクト直下の `docs/plans/`・`docs/specs/`・`TODO.md`・`DONE.md`・`CLAUDE.md`・`README.md` を閲覧・編集できる。

- `Root` タブで `TODO.md` / `DONE.md` / `CLAUDE.md` / `README.md` をプレビュー表示・編集できる
  - 編集は楽観ロック（mtime チェック）付き。外部で先に更新されていた場合は保存時に 409 を返し、リロード / 手元維持 / 強制上書き を選べる
  - `fs.watch` + 2 秒ポーリングで外部変更を検知し、SSE でクライアントへ即時反映する
- ローカル開発専用（本番管理画面とは独立）
- ポート変更は `--port` または `VIBEBOARD_PORT` 環境変数で指定可能

## タスク管理ルール

- タスクは `TODO.md` で管理する
- タスクが完了したら `TODO.md` から該当項目を削除し、`DONE.md` に移動する
- `DONE.md` には完了日を `YYYY-MM-DD` 形式で付けて記録する
- 新しいタスクが発生したら `TODO.md` の適切なセクションに追加する
- タスクの実施前に `TODO.md` を確認し、優先度の高いものから着手する
- コミット時に `TODO.md` を確認し、実装した機能に対応するタスクがあれば `DONE.md` に移動する

## 作業着手ルール

作業（実装・調査いずれも）を始めるときは、コードに手を入れる前に以下を行う。

1. **プランファイルを作成する**: `docs/plans/<task-name>.md` に実装プラン or 調査プランを作成する
   - 目的・背景、対応方針、影響範囲、テスト方針を最低限記載する
   - 複数 Phase / Step に分かれる場合はファイル内でも Phase / Step を明示する
2. **`TODO.md` に該当項目があるか確認する**
   - 無ければ適切なセクションに追加する
   - 既存項目があれば、その項目に作成したプランファイルへのリンクを追記する（例: `[plan](docs/plans/<task-name>.md)`）
3. **複数 Phase / Step がある場合は `TODO.md` に子タスクとして追加する**
   - 親項目の下にインデントしたチェックボックスで Phase / Step を列挙する
   - Phase / Step が完了するごとにチェックを入れ、全完了で親項目を `DONE.md` に移す
4. **作業完了時の後片付け**
   - 親タスクを `DONE.md` に移動する
   - 対応するプランファイルは `docs/plans/archive/` に移動する

<!-- vibeboard:end -->
