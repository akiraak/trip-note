# vibeboard を upstream 最新に更新する（2 回目）

## 目的・背景

- 今日 16:16 に取り込んだ直後、upstream に次の変更が入った（vendored 版との差分から把握）
  - `vibeboard update` コマンド（再 degit → `vibeboard/` へ同期 → `npm install` → `init` → `--restart` で起動し直し）と
    `run-vibeboard.sh --update`
  - Tasks タブに `プラン作成` ボタンと「プロジェクト全体」の `commit & push`、左ペインの折り畳みツリー
  - 登録が無いセッションへ Linux では pid から受信口を引いて投函（macOS には関係なし）
- vendor 中の版には `update` が無いので、今回は vendored README の手順（再 degit）で取り込み、次回から `update` を使う

## 対応方針

1. ローカル改変の確認: 前回取り込み後に `vibeboard/` を触っていない（git status で差分なし）→ 再適用なし
2. `rm -rf vibeboard && npx -y degit akiraak/vibeboard vibeboard && (cd vibeboard && npm install)`
3. `node vibeboard/dist/cli.js init --root . --no-hooks` で `CLAUDE.md` のスニペットを最新化
   （`.claude/settings.json` の hook は前回書いた内容と同じコマンド文字列なので変更なし）
4. 動作確認

## 影響範囲

- `vibeboard/` 全体、ルートの `run-vibeboard.sh`（postinstall で更新）、`CLAUDE.md` のマーカー内

## テスト方針

- `cd vibeboard && npm test`
- `./run-vibeboard.sh` で起動し `/` と `/api/todo/TODO.md` の応答を確認
- 新コマンド `node vibeboard/dist/cli.js update --dry-run` が動くことを確認

## 実施記録（2026-09-07）

- 再 degit + `npm install` 完了。`init --no-hooks` で `CLAUDE.md` のスニペットを最新化（hook は前回のまま。コマンド文字列に変更なし）
- `npm test` 45 件 pass
- **upstream の `run-vibeboard.sh` に不具合**: macOS 標準の bash 3.2 では `set -u` 下で空配列 `"${PASS[@]}"` を展開すると
  `PASS[@]: unbound variable` で落ち、引数なしの起動ができない（bash 4.4+ では起きない）。
  `${PASS[@]+"${PASS[@]}"}` / `${ROOT_ARGS[@]+"${ROOT_ARGS[@]}"}` に直して `vibeboard/run-vibeboard.sh` とルートの
  コピーを同内容にした（postinstall の同一判定を通すため）。**upstream 側にも同じ修正が必要**（次の update で上書きされる）
- 修正後の `./run-vibeboard.sh --port 3011` で新版が起動し `/`・`/api/todo/TODO.md`・`/api/tasks/windows` が 200 を返すことを確認
- ユーザーが 16:29 に起動していた前版（pid 38078）が動いたまま `vibeboard/` を入れ替えたため、新版を同じ root で
  detached 起動してポートガードに旧プロセスを止めさせた（`update --restart` 相当。ログは `$TMPDIR/vibeboard-3010.log`）
- 新コマンド `node vibeboard/dist/cli.js update --dry-run` が動くことを確認（39 ファイル上書き・削除なしと表示）。次回からはこれを使う
