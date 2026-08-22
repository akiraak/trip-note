import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { fetchRouteLegs, parseRouteLegsBody } from "@/lib/routing";

// 道路ルート(レグ = 隣接チェックポイント間)の解決 API(iOS 向け)。
// 1 リクエストで複数レグをまとめて解決し、入力と同順・同数で返す。
// 解決できないレグは null(クライアントは直線フォールバック)

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
  const legs = parseRouteLegsBody(body);
  if (!legs) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const resolved = await fetchRouteLegs(legs);
  return NextResponse.json({ legs: resolved });
}
