// その日の経路(前泊地 + 訪問順のチェックポイント)。
// 地図検索の範囲ヒント(Nominatim viewbox)と AI 検索補助の文脈に使う。
// iOS 側 ios/TripNote/Domain/DayRoute.swift と同じ規約

export type DayRoutePlace = {
  name: string;
  latitude: number | null;
  longitude: number | null;
};

/** `[minLon, minLat, maxLon, maxLat]`(Nominatim の viewbox の並び) */
export type Viewbox = [number, number, number, number];

/** 検索範囲の一辺の下限(緯度 0.18° ≈ 20km。市内観光の日でも周辺の候補が拾えるように) */
const MIN_HALF_SPAN_DEG = 0.09;
/** 経路の外接矩形に対する余白(経路の少し外側まで候補に入れる) */
const SPAN_SCALE = 1.5;

type RouteDay = { checkpoints: DayRoutePlace[] };

/** 前日までの最後の座標ありチェックポイント(前泊地など) */
export function routeAnchor(
  days: RouteDay[],
  index: number,
): DayRoutePlace | null {
  for (let i = index - 1; i >= 0; i--) {
    const found = [...days[i].checkpoints]
      .reverse()
      .find((c) => c.latitude !== null && c.longitude !== null);
    if (found) return toPlace(found);
  }
  return null;
}

/** index 日目の経路。座標なし CP も名前だけ含める(AI 補助には行程の文脈として有用) */
export function dayRoute(days: RouteDay[], index: number): DayRoutePlace[] {
  const day = days[index];
  if (!day) return [];
  const anchor = routeAnchor(days, index);
  return [...(anchor ? [anchor] : []), ...day.checkpoints.map(toPlace)];
}

/** 経路の座標あり地点を囲む検索範囲。座標が 1 つも無ければ null */
export function searchViewbox(places: DayRoutePlace[]): Viewbox | null {
  const lats: number[] = [];
  const lons: number[] = [];
  for (const p of places) {
    if (p.latitude !== null && p.longitude !== null) {
      lats.push(p.latitude);
      lons.push(p.longitude);
    }
  }
  if (lats.length === 0) return null;
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  // 経度の下限は中心緯度で 20km 相当になるよう cos で伸ばす
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const halfLat = Math.max(((maxLat - minLat) / 2) * SPAN_SCALE, MIN_HALF_SPAN_DEG);
  const halfLon = Math.max(
    ((maxLon - minLon) / 2) * SPAN_SCALE,
    MIN_HALF_SPAN_DEG / cosLat,
  );
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return [
    round(centerLon - halfLon),
    round(Math.max(centerLat - halfLat, -90)),
    round(centerLon + halfLon),
    round(Math.min(centerLat + halfLat, 90)),
  ];
}

export function isViewbox(value: unknown): value is Viewbox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function toPlace(p: DayRoutePlace): DayRoutePlace {
  return { name: p.name, latitude: p.latitude, longitude: p.longitude };
}
