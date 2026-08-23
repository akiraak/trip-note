import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import {
  parseLinkInput,
  resolveGoogleMapsLink,
} from "@/lib/google-maps-share";

// iOS 向けの「Google Maps の共有リンクから場所を取り出す」解決。
// 短縮リンクの展開と URL のパースは lib/google-maps-share.ts(Web の Server Action と共通)

export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  let link: string;
  try {
    link = parseLinkInput((body as Record<string, unknown> | null)?.link);
  } catch (error) {
    const message = error instanceof Error ? error.message : "不正な入力です";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try {
    return NextResponse.json({ place: await resolveGoogleMapsLink(link) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "リンクを解決できませんでした";
    // 502/504 は Cloudflare がボディを差し替えてメッセージが届かないため 500 で返す
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
