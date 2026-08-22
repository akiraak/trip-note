import { NextResponse } from "next/server";
import { parseSearchAssistInput, searchAssist } from "@/lib/ai";
import { authorized } from "@/lib/auth";

// iOS 向けの AI 検索補助。大まかな地域 + 種別 + 自由記述から、
// 地図検索(MapKit / Nominatim)のクエリ候補と具体的な地点候補を返す

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
  let input;
  try {
    input = parseSearchAssistInput(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "不正な入力です";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try {
    return NextResponse.json(await searchAssist(input));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI の呼び出しに失敗しました";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
