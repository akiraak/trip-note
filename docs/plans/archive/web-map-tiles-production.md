# Web の地図タイルを本番向けに差し替える

## 目的・背景

Web の trip 詳細ページの地図（`web/src/app/trips/[id]/trip-map.tsx`）は、Phase 3 で暫定的に
OSM 公式ラスタタイル（`tile.openstreetmap.org`）を使っている。OSM のタイル利用ポリシー上、
本番サービスからの継続アクセスには不適のため、本番向けのタイルソースへ差し替える
（docs/specs/phase3-map-display.md に記載済みの後続タスク）。

## タイルソースの検討

| 候補 | 評価 |
| --- | --- |
| **OpenFreeMap（採用）** | 登録・API キー不要、利用制限なしで本番・商用利用が公式に許可。MapLibre 用ベクタスタイル URL をそのまま渡せて差し替えが 1 行。帰属表記は TileJSON に含まれ MapLibre が自動表示。ドネーション運営のため SLA はないが、単一ユーザーアプリには十分 |
| MapTiler | 要アカウント + API キー（クライアントに露出、ドメイン制限で緩和）。無料枠 100k タイル/月。キー管理の手間が増えるわりに本用途では利点なし |
| Protomaps（ホスト API） | 要アカウント + API キー。同上 |
| Protomaps（セルフホスト PMTiles） | 完全自己完結だが、地域抽出 PMTiles の配置・glyphs / sprites・スタイル生成・g3plus 側のデプロイ変更が必要。単一ユーザー用途には過剰。将来外部依存を切りたくなったときの選択肢として記録 |

採用: **OpenFreeMap の Liberty スタイル**（`https://tiles.openfreemap.org/styles/liberty`）。
ベクタタイルのためラスタより拡大時の描画も良い。

## 対応方針

1. `trip-map.tsx` のインライン `OSM_STYLE`（StyleSpecification）を削除し、
   OpenFreeMap Liberty のスタイル URL 定数に置き換える
2. `docs/specs/phase3-map-display.md` のタイル記述を現状に合わせて更新する

環境変数化（`NEXT_PUBLIC_*`）はしない。Next.js ではビルド時インライン化されるため
デプロイ契約（deploy-g3plus.md / g3plus-ops）の変更が必要になり、差し替え頻度に対して過剰なため。
将来変更する場合もコード上の定数 1 箇所の変更で済む。

## 影響範囲

- `web/src/app/trips/[id]/trip-map.tsx` のみ（クライアントサイドのタイル参照先の変更。
  サーバ・DB・env・iOS には影響なし）
- `docs/specs/phase3-map-display.md` の記述更新

## テスト方針

- `npm run lint` + `npm run build` 成功
- ローカル dev サーバで trip 詳細ページを開き、タイル描画・軌跡・マーカー・帰属表記を目視確認
- 本番（trip.chobi.me）デプロイ後に同様の疎通確認
