# vibeboard を upstream 最新に更新する

## 目的・背景

- プロジェクト直下に degit で vendor している vibeboard（2026-08-21 取り込み、package.json 上は 0.2.0）が古くなった
- upstream には次が入っている（vendored 版との差分から把握）
  - `Tasks` タブ: `TODO.md` のタスクを、このプロジェクトで動いている Claude Code セッションへ投函して実行 / 説明 / 削除
  - `Files` タブ: `--root` 配下のファイルをすべて編集（専用の `Root` タブは廃止）
  - タスク（`- [ ]`）を含む Markdown のツリー表示（`[~]` 進行中 / `[-]` 中止、`依存:` / `派生元:` / `関連:` の関係チップ）
  - `run-vibeboard.sh` を `npm install` の postinstall でプロジェクトルートへ自動配置
  - 同じ `--root` の旧プロセスがポートを掴んでいたら自動停止して起動し直す
  - customTabs の `command`（プラグインを一緒に起動）、`npm test`
- vibeboard/README.md の「upstream の取り込み直し」手順に従って再 degit する

## 対応方針

1. **ローカル改変の有無を確認する**: 親リポで `vibeboard/` を触ったコミットは初回 vendor（`fd93d8d`）のみ
   → 再適用すべきカスタマイズ差分は無い
2. **再 degit**: `rm -rf vibeboard && npx -y degit akiraak/vibeboard vibeboard && (cd vibeboard && npm install)`
   - `prepare` で `dist/` を生成、`postinstall` で `run-vibeboard.sh` をルートへ配置
3. **`init` を流し直す**: `node vibeboard/dist/cli.js init --root .`
   - `CLAUDE.md` の `<!-- vibeboard:begin -->` 〜 `<!-- vibeboard:end -->` 内を最新スニペットに置換
     （`Root` タブ → `Files` タブ、`Tasks` タブの説明、タスク管理ルールの追記）
   - `.claude/settings.json` に SessionStart / SessionEnd の hook（`vibeboard/scripts/session-hook.mjs`）を書く
     （Tasks タブの送り先登録に必要。コミット対象）
4. **動作確認**（下記）

## 影響範囲

- `vibeboard/` 全体（`src/` `sample/` `README.md` など。`dist/` `node_modules/` は親の .gitignore 済み）
- 新規: ルートの `run-vibeboard.sh`、`.claude/settings.json`
- `CLAUDE.md` のマーカー内（vibeboard 節・タスク管理ルール）
- `TODO.md` の書式は変えない（新ルールにある親項目の `- [ ]` 化や `[~]` 表記の導入は別タスクとして判断する）

## テスト方針

- `init --dry-run` で書き込み内容を目視してから実行する
- `cd vibeboard && npm test`
- `./run-vibeboard.sh` で起動し、`/` と `/api/todo/TODO.md` が応答することを curl で確認する

## 実施記録（2026-09-07）

- 再 degit + `npm install` 完了。ルートの `run-vibeboard.sh`（初回 vendor 時から git 管理済み）は postinstall で最新版に上書きされた
- `init --no-hooks` で `CLAUDE.md` のマーカー内を最新スニペットに置換した
- `.claude/settings.json` への hook 書き込み（`init` 本実行）は Claude Code の auto mode で承認が下りず未実施。
  `node vibeboard/dist/cli.js init --root .` を手で流せば冪等に併合される（他の hooks があれば残す）。
  hook を入れるまで Tasks タブの送り先は「未登録」のままで、`listen` を回すか hook を入れる必要がある
- `npm test` 38 件 pass。`./run-vibeboard.sh` で起動し、`/` 200・`/api/todo/TODO.md` がツリー JSON を返すことを確認。
  `/api/tasks/windows` は `claude agents --json` からこのセッションを拾えていた（`hooksInstalled: false`）
- `TODO.md` の書式は変えていない。現状は親項目がチェックボックス無しの箇条書きなので、vibeboard のツリーでは
  子の `- [ ]` だけがタスクとして拾われ、親の文面はタスク扱いにならない（ツリー上で親子にならない）。
  新ルールに合わせて親を `- [ ]` にするかは別タスクで判断する
- その後 `node vibeboard/dist/cli.js init --root .` を手で実行し、`.claude/settings.json` に hook を書いた（コミット対象）
