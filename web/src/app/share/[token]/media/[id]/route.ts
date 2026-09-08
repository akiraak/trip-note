import { mediaFileResponse } from "@/lib/media-stream";
import { readSharedMedia } from "@/lib/share";

// 共有ページ向けのメディア配信(docs/plans/share-page.md)。
// そのトークンの旅行に属する、削除済みでないメディアだけを返す(他は 404)。
// /media/[id] は本番で Cloudflare Access の Allow 配下のままなので、共有ページはこちらを使う。
// 配信処理(Range 対応)は lib/media-stream.ts で /media/[id] と共通

export async function GET(
  request: Request,
  ctx: RouteContext<"/share/[token]/media/[id]">,
) {
  const { token, id } = await ctx.params;
  const row = readSharedMedia(token, id);
  if (!row) {
    return new Response("not found", { status: 404 });
  }
  return mediaFileResponse(request, row.storage_path);
}
