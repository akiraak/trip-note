# TODO.md の親項目に `[ ]` を付け、vibeboard init のルールにも明記する

## 目的・背景

- 9/7 の vibeboard 更新で Tasks タブとタスクのパーサ（`vibeboard/src/todo.ts`）が入った。パーサは
  `- [ ]` / `[x]` / `[~]` / `[-]` の行だけをタスクとして拾い、`- 文面` のようにチェックボックスの無い行は
  直前のタスクのメモとして扱う
- trip-note の `TODO.md` は 8 月から親項目に `[ ]` を付けない書き方だったため、親項目 6 行が Tasks タブと
  ツリーから丸ごと落ち、Phase / Step の子タスクが親を失ってトップレベルに並んでいた。9/7 に追加した
  「旅行の工程と写真が見れるページ」は子が無いので何も出ず、その下の「決定:」メモは Tailscale の Step 5 に付いていた
- `vibeboard init` が `CLAUDE.md` に書くスニペットには「TODO.md に書くのはタスク（`- [ ]`）だけ」とあるが、
  親項目にも必要なこと・無い行がどう扱われるかが書かれておらず、守られていなかった

## 対応方針

1. `TODO.md` の親項目 6 行の行頭を `- ` → `- [ ] ` に直す
2. vibeboard のスニペット（`vibeboard/src/templates/claude-md-snippet.md`）の「タスク管理ルール」に、
   タスクの行は親項目も含めて必ず `- [ ] 文面` の形で書くこと、チェックボックスの無い行はメモ扱いで
   ツリーにも Tasks タブにも出ないことを明記し、親子とメモの書き方の例を添える。
   `vibeboard/README.md` の同スニペットの写しも同内容にする
3. `node vibeboard/dist/cli.js init --root . --no-hooks` で `CLAUDE.md` のマーカー内を更新する

## 影響範囲

- `TODO.md`、`CLAUDE.md`（マーカー内）、`vibeboard/src/templates/claude-md-snippet.md`、`vibeboard/README.md`
- `vibeboard/` は upstream の写しなので、**upstream（akiraak/vibeboard）にも同じ変更を入れないと次の `update` で消える**

## テスト方針

- `vibeboard/dist/todo.js` の `parseTodo` に `TODO.md` を通し、親 6 件が depth 0、Phase / Step が depth 1、
  「決定:」メモが共有ページのタスクに付くことを確認する
- 起動中の vibeboard（`http://localhost:3010`）の `/api/todo/TODO.md` に新しい親項目が出ることを確認する
- `cd vibeboard && npm test`

## 実施記録（2026-09-08）

- `TODO.md` の親項目 6 行に `[ ]` を付けた。`parseTodo` で親 6 件が depth 0、Phase / Step が depth 1、
  「決定:」メモが共有ページのタスクに付くことを確認。起動中の vibeboard の `/api/todo/TODO.md` でも同じツリーになった
- スニペット（`claude-md-snippet.md`）と `README.md` の写しに、親項目も `- [ ] 文面` で書くこと・
  チェックボックスの無い行はメモ扱いで Tasks タブに出ないこと・親子とメモの例を追記した。
  `init --no-hooks` で `CLAUDE.md` のマーカー内を更新（マーカー外は変更なし）
- `cd vibeboard && npm test` 45 件 pass
- **upstream（akiraak/vibeboard）未反映**。bash 3.2 の修正と合わせて upstream に入れないと次の `update` で消える
