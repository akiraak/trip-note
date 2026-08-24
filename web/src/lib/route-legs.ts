import { haversineDistance } from "./geo";

// 日毎プランのルートを「隣接チェックポイント間のレグ(区間)」として扱うための型と純ロジック。
// iOS の Domain/RouteLegs.swift と同じ規約にしてある(レグキャッシュはサーバの
// route_legs テーブルで iOS と共有するため、キーの作り方がずれると共有できない)。
//
// lib/routing.ts は node:net と better-sqlite3 に依存しクライアントから import できないので、
// キー規約とレグ組み立てはこちらに置き、routing.ts もここから legKey を取り込む。

/** レグの端点。checkpoints の座標 1 点ぶん */
export type RoutePoint = { latitude: number; longitude: number };

/** 隣接チェックポイント間のレグ(区間) */
export type Leg = { from: RoutePoint; to: RoutePoint };

/** 解決済みレグ。coordinates は GeoJSON LineString と同じ [lon, lat] のペア列 */
export type ResolvedLeg = {
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
};

/** 座標の丸め(約 10m 粒度)。キーの同一判定もこの粒度で行う */
function rounded(value: number): string {
  return value.toFixed(4);
}

/// キャッシュキー。座標を小数 4 桁(約 10m 粒度)で丸めるので、チェックポイント id や
/// 並び順に依存せず「同じ区間」なら並び替え・途中挿入後もキャッシュが効く
export function legKey(from: RoutePoint, to: RoutePoint): string {
  return `${rounded(from.latitude)},${rounded(from.longitude)}>${rounded(to.latitude)},${rounded(to.longitude)}`;
}

/** 丸め粒度で同一地点になるレグ(距離ほぼ 0)。解決を頼む意味が無い */
export function isDegenerate({ from, to }: Leg): boolean {
  return (
    rounded(from.latitude) === rounded(to.latitude) &&
    rounded(from.longitude) === rounded(to.longitude)
  );
}

/// 訪問順の座標列をレグ列にする(iOS の RouteLegBuilder.legs と同じ)。
/// 座標なしのチェックポイントは呼び出し側で除外済みの前提。
/// start(前泊地などの起点)があれば先頭に差し込む
export function buildLegs({
  start = null,
  points,
}: {
  start?: RoutePoint | null;
  points: RoutePoint[];
}): Leg[] {
  const route = start ? [start, ...points] : points;
  const legs: Leg[] = [];
  for (let i = 1; i < route.length; i++) {
    const leg = { from: route[i - 1], to: route[i] };
    if (!isDegenerate(leg)) {
      legs.push(leg);
    }
  }
  return legs;
}

/// レグ列の総距離(メートル)。解決済みレグは道路距離、未解決レグは直線距離
/// (Haversine)でフォールバックした概算(iOS の RouteLegDistance.totalMeters と同じ)
export function totalLegMeters(
  legs: Leg[],
  resolved: Record<string, ResolvedLeg>,
): number {
  return legs.reduce((sum, leg) => {
    const hit = resolved[legKey(leg.from, leg.to)];
    if (hit) {
      return sum + hit.distanceM;
    }
    return (
      sum +
      haversineDistance(
        leg.from.latitude,
        leg.from.longitude,
        leg.to.latitude,
        leg.to.longitude,
      )
    );
  }, 0);
}

/// レグ列を地図に描くための座標列(GeoJSON MultiLineString の coordinates)。
/// 解決済みレグは道路形状、未解決レグは端点を結んだ直線にする
export function legLines(
  legs: Leg[],
  resolved: Record<string, ResolvedLeg>,
): [number, number][][] {
  return legs.map((leg) => {
    const hit = resolved[legKey(leg.from, leg.to)];
    if (hit) {
      return hit.coordinates;
    }
    return [
      [leg.from.longitude, leg.from.latitude],
      [leg.to.longitude, leg.to.latitude],
    ];
  });
}
