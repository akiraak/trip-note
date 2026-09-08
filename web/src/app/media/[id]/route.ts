import { getDb } from "@/lib/db";
import { mediaFileResponse } from "@/lib/media-stream";
import type { Media } from "@/lib/types";

// 閲覧 UI(ブラウザ)向けのメディア配信。/api/* ではなく /media/* に置くことで、
// 本番では Cloudflare Access の Allow(Google IdP)配下に入る(Bearer 不要)。
// 共有ページ向けは /share/[token]/media/[id](トークンの旅行に属するものだけ)。
// 配信処理(Range 対応)は lib/media-stream.ts で共通

export async function GET(request: Request, ctx: RouteContext<"/media/[id]">) {
  const { id } = await ctx.params;
  const db = getDb();
  const row = db.prepare("select * from media where id = ?").get(id) as
    | Media
    | undefined;
  // 削除済み(tombstone)は行だけ残っていてファイルは無い
  if (!row || row.deleted_at) {
    return new Response("not found", { status: 404 });
  }
  return mediaFileResponse(request, row.storage_path);
}
