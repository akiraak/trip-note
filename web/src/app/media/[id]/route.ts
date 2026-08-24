import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getDb, getMediaDir } from "@/lib/db";
import type { Media } from "@/lib/types";

// 閲覧 UI(ブラウザ)向けのメディア配信。/api/* ではなく /media/* に置くことで、
// 本番では Cloudflare Access の Allow(Google IdP)配下に入る(Bearer 不要)。
// Safari の動画再生は Range が必須のため 206 に対応する

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

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
  // 配信元は実行時にしか決まらないため Turbopack のファイルトレースから除外する
  const filePath = path.join(/*turbopackIgnore: true*/ getMediaDir(), row.storage_path);
  if (!existsSync(filePath)) {
    return new Response("not found", { status: 404 });
  }

  const size = statSync(filePath).size;
  const headers = new Headers({
    "content-type":
      CONTENT_TYPES[path.extname(row.storage_path).toLowerCase()] ??
      "application/octet-stream",
    "accept-ranges": "bytes",
    // メディアは不変なのでブラウザに長期キャッシュさせる(認証付きのため private)
    "cache-control": "private, max-age=31536000, immutable",
  });

  const match = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] !== "" || match[2] !== "")) {
    // bytes=a-b / bytes=a- / bytes=-suffix の 3 形式に対応する
    const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
    const end =
      match[1] !== "" && match[2] !== ""
        ? Math.min(Number(match[2]), size - 1)
        : size - 1;
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    const stream = Readable.toWeb(
      createReadStream(filePath, { start, end }),
    ) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("content-length", String(size));
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
