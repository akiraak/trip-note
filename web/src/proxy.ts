import { NextResponse, type NextRequest } from "next/server";
import {
  isSharePath,
  isShareMethodAllowed,
  SHARE_ALLOWED_METHODS,
} from "@/lib/share-guard";

// /share/* は本番で Cloudflare Access を Bypass する唯一の閲覧経路(docs/plans/share-page.md)。
// Server Action(POST)を公開経路から叩かせないため、GET / HEAD 以外は 405 で止める。
// matcher で /share/* に絞ったうえで、対象パスの判定も自分で確かめる(matcher を
// 広げてしまっても他のパスを止めない)。判定は lib/share-guard.ts(ユニットテスト対象)

export function proxy(request: NextRequest) {
  if (isSharePath(request.nextUrl.pathname) && !isShareMethodAllowed(request.method)) {
    return new NextResponse("method not allowed", {
      status: 405,
      headers: { allow: SHARE_ALLOWED_METHODS.join(", ") },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/share/:path*",
};
