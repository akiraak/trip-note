import { NextResponse } from "next/server";
import { parsePlanInput, suggestPlan } from "@/lib/ai";
import { authorized } from "@/lib/auth";

// iOS 向けの AI 行程提案。入力 = 出発地・到着予定地・開始日・日数・移動手段・要望、
// 出力 = 日別の大まかな行程(採用するかはクライアントが決める。ここでは DB に書かない)。
// Web は Server Action から lib/ai.ts を直接呼ぶ(この route は使わない)

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
    input = parsePlanInput(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "不正な入力です";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try {
    return NextResponse.json(await suggestPlan(input));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI の呼び出しに失敗しました";
    // 502/504 は Cloudflare がボディを自前のエラーページに差し替えて
    // クライアントへメッセージが届かないため 500 で返す
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
