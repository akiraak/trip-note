# Web からも写真・動画を削除できるようにする

## 目的・背景

削除は iOS だけの操作として実装した([media-delete-and-import](archive/media-delete-and-import.md))が、
**Web の閲覧中に消したいものを見つけても消せない**。Web にも削除を足す。

ただし今の media は**不変・一方向アップロード**(iOS → サーバ。pull しない)なので、
Web で行とファイルを消しても **iOS 側にはローカルのコピーが残り続けて表示がずれる**。
そのため「Web から消せる」だけでは足りず、**削除を iOS へ伝える経路**が要る。

## 対応方針

**media の削除だけを双方向にする**(ファイル本体は従来どおり一方向アップロードのまま)。

- サーバの media に `deleted_at`(tombstone)を足す。**削除時にファイルは物理削除**し、
  **行は tombstone として残す**(iOS に「消えた」と伝えるため)
- 削除の実処理は `web/src/lib/media.ts` に集約し、**Web の Server Action と
  `DELETE /api/media`(iOS)の両方が同じ関数を呼ぶ**
- `GET /api/sync/pull` の応答に **media の tombstone**(`id` / `trip_id` / `deleted_at`)を足す。
  iOS は pull で受けたらローカルのファイルと行を消す
- 表示・配信は tombstone を除外する(旅行詳細のグリッド・地図マーカー、`GET /media/[id]` は 404)
- 再アップロード対策: `POST /api/media` は**既に tombstone の id ならファイルを書かずに 200** を返す
  (Web で消した直後に iOS が再送してもファイルが復活しない。iOS は次の pull で行を消す)

## 影響範囲

### Web / サーバ

- `src/lib/db.ts`: `alter table media add column deleted_at text` のマイグレーションを追加
- `src/lib/media.ts`(新規): `deleteMedia(id)` = ファイル削除 + tombstone(冪等)
- `src/app/api/media/route.ts`: DELETE は `deleteMedia` を呼ぶ形に。POST に tombstone チェック
- `src/app/api/sync/pull/route.ts`: `media`(tombstone のみ)を応答に追加
- `src/app/media/[id]/route.ts`: tombstone は 404
- `src/app/trips/[id]/page.tsx`: メディアの取得に `deleted_at is null`
- `src/app/trips/[id]/delete-media.tsx`(新規)+ `actions.ts`: 二段階確認の削除
  (`DeleteTrip` と同じ作法)

### iOS

- `Models/PullRecords.swift`: `MediaPullRecord` を追加(`media` は**旧サーバ互換で省略可**)
- `Services/SyncEngine.swift`: pull 適用時に tombstone のメディアをローカルから削除
  (ファイル + 行)。すでにローカルに無ければ何もしない

### ドキュメント

- `docs/specs/server-api.md`: DELETE の挙動(tombstone 化)と pull の media を追記
- `docs/specs/phase4-media.md`: 削除の節を「iOS / Web どちらからでも」に更新

## Phase

- **Phase 1**: サーバ(マイグレーション・lib・DELETE/POST・pull・配信・表示)
- **Phase 2**: Web の削除 UI(Server Action + 二段階確認)
- **Phase 3**: iOS の pull 適用
- **Phase 4**: 検証(Web lint/build + curl、iOS テスト、シミュレータ E2E で
  「Web で削除 → iOS の同期で消える」)

## テスト方針

- Web: `npm run lint` / `npm run build`。dev サーバに curl で
  DELETE 200 → 行が tombstone・ファイル削除 → `GET /media/[id]` 404 →
  pull に media tombstone が出る → 再 POST でファイルが復活しない
- iOS: pull 応答のデコード(media あり/なし)のユニットテスト。
  シミュレータで「Web から削除 → iOS を同期 → グリッドから消える」を目視
