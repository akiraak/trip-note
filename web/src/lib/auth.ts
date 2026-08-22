import { timingSafeEqual } from "node:crypto";

// /api/* を守る共有シークレット認証(API_SHARED_SECRET と定数時間比較)。
// 本番の Cloudflare Access は /api/* を Bypass し、認証はこの Bearer のみ
export function authorized(header: string | null): boolean {
  const secret = process.env.API_SHARED_SECRET;
  if (!secret || !header || !header.startsWith("Bearer ")) {
    return false;
  }
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
