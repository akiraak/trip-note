import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { isSearchCategory } from "@/lib/category-search";
import { parseRouteInput } from "@/lib/day-route";
import { fetchNearbyPlaces, routeCoordinates } from "@/lib/overpass";

// iOS 向けの「その日の経路の近くを カテゴリ(観光地など)で探す」検索。
// 実体は OSM Overpass のプロキシ(lib/overpass.ts)

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
  const { category, route } = (body ?? {}) as Record<string, unknown>;
  if (!isSearchCategory(category)) {
    return NextResponse.json({ error: "不正なカテゴリです" }, { status: 400 });
  }
  let parsedRoute;
  try {
    parsedRoute = parseRouteInput(route);
  } catch (error) {
    const message = error instanceof Error ? error.message : "不正な入力です";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (!parsedRoute || routeCoordinates(parsedRoute).length === 0) {
    return NextResponse.json({ error: "経路に座標がありません" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      places: await fetchNearbyPlaces(category, parsedRoute),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "検索に失敗しました";
    // 502/504 は Cloudflare がボディを差し替えてメッセージが届かないため 500 で返す
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
