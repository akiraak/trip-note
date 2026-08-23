"use server";

import { legKey, type Leg, type ResolvedLeg } from "@/lib/route-legs";
import {
  fetchRouteLegs,
  parseRouteLegsBody,
  MAX_LEGS_PER_REQUEST,
} from "@/lib/routing";

// 閲覧 UI 用の道路ルート解決。/api/route は API_SHARED_SECRET の Bearer が要る
// iOS 向けの契約で、ブラウザはその Bearer を持たない。actions.ts と同じく
// 「ページと同じ保護範囲(本番は Cloudflare Access)で動く Server Action」として
// サーバ内で fetchRouteLegs() を直接呼ぶ(シークレットは出さず /api/* の契約も変えない)。
// 表示専用なので revalidatePath はしない

/// レグ列を「レグキー → 解決済みレグ」へ解決する。
/// 解決できなかったレグはキーごと結果に含めない(呼び出し側は直線フォールバック)
export async function resolveRouteLegsAction(
  legs: Leg[],
): Promise<Record<string, ResolvedLeg>> {
  // Server Action の引数はクライアント由来なので /api/route と同じ検証を通す。
  // 上限超えは切り詰める(呼び出し側がチャンクするので通常は起きない)
  const parsed = parseRouteLegsBody({
    legs: Array.isArray(legs) ? legs.slice(0, MAX_LEGS_PER_REQUEST) : [],
  });
  if (!parsed) {
    return {};
  }
  const resolved = await fetchRouteLegs(parsed);
  const found: Record<string, ResolvedLeg> = {};
  parsed.forEach((leg, index) => {
    const hit = resolved[index];
    // 線として成立しない(2 点未満)ものは解決扱いにしない(iOS の RouteLegPolyline と同じ)
    if (hit && hit.coordinates.length >= 2) {
      found[legKey(leg.from, leg.to)] = hit;
    }
  });
  return found;
}
