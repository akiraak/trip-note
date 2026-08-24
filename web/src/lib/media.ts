import fs from "node:fs";
import path from "node:path";
import { getDb, getMediaDir } from "./db";

// メディア削除の実処理。Web の Server Action(閲覧 UI)と
// DELETE /api/media(iOS からの同期)の両方がここを呼ぶ。
// ファイルは物理削除し、行は tombstone として残す(iOS が pull で
// 「消えた」ことを知り、ローカルのファイルと行を消すため)。
// 仕様: docs/specs/phase4-media.md

/// 削除する。既に tombstone の場合もファイルを消し直して true を返す(冪等)。
/// 行が無ければ false(呼び出し側が 404 にする)
export function deleteMedia(id: string): boolean {
  const db = getDb();
  const row = db
    .prepare("select storage_path, deleted_at from media where id = ?")
    .get(id) as { storage_path: string; deleted_at: string | null } | undefined;
  if (!row) {
    return false;
  }
  // 保存先は実行時にしか決まらないため Turbopack のファイルトレースから除外する
  fs.rmSync(path.join(/*turbopackIgnore: true*/ getMediaDir(), row.storage_path), {
    force: true,
  });
  if (!row.deleted_at) {
    db.prepare(
      `update media set deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       where id = ?`,
    ).run(id);
  }
  return true;
}

/// 削除済みか(再アップロードを弾くのに使う)
export function isDeleted(id: string): boolean {
  const row = getDb()
    .prepare("select deleted_at from media where id = ?")
    .get(id) as { deleted_at: string | null } | undefined;
  return row?.deleted_at != null;
}
