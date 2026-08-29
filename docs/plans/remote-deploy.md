# 家の外から g3plus にデプロイする（Tailscale）

## 目的・背景

g3plus への接続は `ssh -i ~/.ssh/id_rsa_nopass ubuntu@g3plus.lan`（10.0.1.10）だけで、**LAN の中からしか届かない**。
外出先ではデプロイもログ確認も障害対応もできない。

実際に 2026-08-25、trip-note の同期修正（コミット `00bda4a`）をコミットしたものの、本番へ反映できない状態になった。

**方針: Tailscale を入れて、どこからでも SSH できるようにする。**（2026-08-25 決定。このプランは設計だけで、導入は後日）

## 現状の整理

- 外向きに開いているのは Cloudflare Tunnel（tunnel 名 `g3plus`）の HTTP だけ。SSH は通していない
- g3plus は Ubuntu 24.04.3 LTS / Intel N150 4 コア / 16GB。ネットワークは Wi-Fi（`wlp1s0`）
- サーバ上の作業ユーザーは `ubuntu`、鍵認証（`~/.ssh/id_rsa_nopass`）。
  **パスワード無しの sudo は不可**（`docs/workflows/daily-ai-music.md` に記録あり）
- LAN にはもう 1 台 ras（Raspberry Pi 5、10.0.1.138）があり、こちらも同じく外から届かない

### 検討した他の選択肢（不採用）

| 方式 | できること | 見送った理由 |
| --- | --- | --- |
| cron 型の自動デプロイ（`auto-update.sh`） | push = 本番反映 | デプロイしかできない。ログ・DB・再起動は外からできないまま。**Tailscale と排他ではないので、後から足すのは有効** |
| Cloudflare Tunnel 経由の SSH | SSH フルアクセス | Zero Trust の手作業が増え、クライアント側にも `cloudflared` / WARP が要る。Tailscale より複雑 |
| デプロイ用 webhook | 叩けばデプロイ | 自作の実装と認証設計が必要で、得るものが少ない |

## Tailscale で何が変わるか

- **どこからでも `ssh ubuntu@g3plus` が通る**（デプロイ・ログ・DB・コンテナ再起動・障害対応がすべて外からできる）
- ポート開放も DDNS も不要（双方から外向きに繋いで NAT を越える）
- iPhone にも入れれば、外出先から本番の様子を見られる
- 増えるのは g3plus 上の常駐プロセス 1 つ（`tailscaled`）と、外部 SaaS への依存

## 段取り

### Step 1: 家（LAN 内）で 1 回だけやる作業

`tailscaled` のインストールには sudo（パスワード入力）が要るので、**この Step は akiraak が対話的に実行する**。

```bash
# g3plus 上で
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # 表示された URL をブラウザで開いてログイン
tailscale ip -4              # 100.x.y.z が振られることを確認
tailscale status
```

- 開発機（Mac）にも入れる: `brew install --cask tailscale`（または App Store 版）→ 同じアカウントでログイン
- iPhone にも入れておく（任意）

### Step 2: 管理画面での設定（tailscale.com/admin）

1. **g3plus のノードキーの有効期限を無効にする**（Machines → g3plus → … → **Disable key expiry**）。
   既定では 180 日でキーが切れ、**切れた瞬間に外から入れなくなる**（家に帰るまで復旧できない）。ここが一番の落とし穴
2. **MagicDNS を有効にする**（Settings → DNS）。`g3plus` という名前で引けるようになる
3. （任意）**subnet router**: g3plus で `sudo tailscale up --advertise-routes=10.0.1.0/24` を実行し、
   管理画面の Machines → g3plus → Edit route settings で承認する。クライアント側は `--accept-routes`。
   これで **ras（10.0.1.138）や他の LAN 機器にも外から届く**

### Step 3: 接続の入り口を整える

`~/.ssh/config`（Mac 側）に足しておくと、家でも外でも同じコマンドで繋がる。

```
Host g3plus
  HostName g3plus            # MagicDNS 名（Tailscale 経由）
  User ubuntu
  IdentityFile ~/.ssh/id_rsa_nopass
```

- 既存の手順（`ubuntu@g3plus.lan` 宛ての scp / ssh）はそのまま動く。**外にいるときだけ宛先を変える**運用でもよいし、
  常に Tailscale 名で繋いでも構わない（LAN 内では直接経路が選ばれる）
- **Tailscale SSH 機能（`tailscale up --ssh`）は使わない**。今の鍵認証のままにして、認証方式を増やさない

### Step 4: 動作確認

- Mac を Wi-Fi から外して（iPhone のテザリング等）`ssh g3plus 'docker ps'` が通ること
- そのまま trip-note のデプロイ手順（`docs/workflows/trip-note.md`）が最後まで通ること

### Step 5: ドキュメントの追従（g3plus-ops 側）

- `CLAUDE.md` の「サーバ接続情報」に Tailscale 経由の接続コマンドと、
  **キー有効期限を無効化してあること**を明記する
- `docs/workflows/` の各手順は宛先が `g3plus.lan` のままでも動くので、**書き換えは必須ではない**。
  外から使う前提の記述を足すだけでよい

## 影響範囲

- g3plus: `tailscaled` の常駐が増える（メモリ数十 MB 程度）。既存のサービス・Cloudflare Tunnel には影響しない
- 開発機・iPhone: Tailscale クライアントの導入
- g3plus-ops: `CLAUDE.md` の接続情報の追記（実装はこのリポジトリではなく g3plus-ops 側）
- trip-note 本体のコードには影響しない

## 注意・リスク

- **ノードキーの期限切れが最大のリスク**（Step 2-1）。外出先で切れると復旧手段が無くなる
- Tailscale のアカウントを失うと入れなくなる。**LAN 内からの `g3plus.lan` 経路は残す**（フォールバック）
- 無料プランは個人利用の範囲（3 ユーザー / 100 デバイス）で足りる
- 外すときは `sudo tailscale down` + アンインストールで元に戻る（他の構成に触らないので影響は局所的）

## 未確定

- subnet router（Step 2-3）まで入れるか、g3plus 1 台だけにするか
- 今回コミット済みの trip-note の修正（`00bda4a`）は、**帰宅後に手動デプロイする**（Tailscale 導入を待たない）
- 将来 cron 型の自動デプロイ（`auto-update.sh`）を足すかどうかは別途。Tailscale とは併用できる
