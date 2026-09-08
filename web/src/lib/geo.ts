// iOS 側 ios/TripNote/Domain/Geo.swift と同等の距離計算
const EARTH_RADIUS_METERS = 6_371_000;

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

export function totalDistance(
  coordinates: { latitude: number; longitude: number }[],
): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineDistance(
      coordinates[i - 1].latitude,
      coordinates[i - 1].longitude,
      coordinates[i].latitude,
      coordinates[i].longitude,
    );
  }
  return total;
}

// GPS 切断・記録停止中を線で結ばないための区間分割の閾値
// (iOS 側 TrackSegmenter.gapThreshold と揃える)
export const TRACK_GAP_THRESHOLD_MS = 10 * 60 * 1000;

/// recorded_at 昇順に並んだ点列を、隣接点の時間ギャップが閾値を超えた箇所で区間に分割する
export function splitByTimeGap<T extends { recorded_at: string }>(
  points: T[],
  thresholdMs: number = TRACK_GAP_THRESHOLD_MS,
): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];
  for (const point of points) {
    const last = current[current.length - 1];
    if (
      last &&
      Date.parse(point.recorded_at) - Date.parse(last.recorded_at) > thresholdMs
    ) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

/// 軌跡全体を含むバウンディングボックス([west, south], [east, north])
export function boundingBox(
  coordinates: { latitude: number; longitude: number }[],
): [[number, number], [number, number]] | null {
  if (coordinates.length === 0) {
    return null;
  }
  let west = coordinates[0].longitude;
  let east = coordinates[0].longitude;
  let south = coordinates[0].latitude;
  let north = coordinates[0].latitude;
  for (const { latitude, longitude } of coordinates) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return [
    [west, south],
    [east, north],
  ];
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

// 表示用のトラックの間引き(Douglas-Peucker)。
// 共有ページは記録点を丸ごとブラウザへ渡すため、長い旅行(数万点)ではページが
// 数 MB〜十数 MB になる。地図に描く線の形はほとんど変わらないので、表示に要らない
// 点をサーバ側で落とす。距離や件数の表示には使わないこと(間引いた値になるため)。
// 時間ギャップで区切ってから区間ごとに間引くので、GPS 切断の切れ目は保たれる

/** 間引きの既定の許容誤差(メートル)。地図の見た目が変わらない範囲で選んである */
export const TRACK_SIMPLIFY_TOLERANCE_M = 15;
/** 間引き後もこの数を超えていたら、許容誤差を倍にして引き直す */
const TRACK_MAX_POINTS = 12_000;

/** 線分 ab から点 p までの距離(メートル)。緯度経度をその場の平面に直して測る */
function perpendicularMeters(
  p: { latitude: number; longitude: number },
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon =
    metersPerDegreeLat * Math.cos((a.latitude * Math.PI) / 180);
  const bx = (b.longitude - a.longitude) * metersPerDegreeLon;
  const by = (b.latitude - a.latitude) * metersPerDegreeLat;
  const px = (p.longitude - a.longitude) * metersPerDegreeLon;
  const py = (p.latitude - a.latitude) * metersPerDegreeLat;
  const length2 = bx * bx + by * by;
  if (length2 === 0) {
    return Math.hypot(px, py);
  }
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / length2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** 1 区間を間引く。再帰にすると点数が多いとスタックが尽きるので明示的なスタックで回す */
function simplifySegment<T extends { latitude: number; longitude: number }>(
  segment: T[],
  tolerance: number,
): T[] {
  if (segment.length <= 2) {
    return segment;
  }
  const keep = new Array<boolean>(segment.length).fill(false);
  keep[0] = true;
  keep[segment.length - 1] = true;
  const stack: [number, number][] = [[0, segment.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicularMeters(segment[i], segment[start], segment[end]);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest > 0) {
      keep[farthest] = true;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return segment.filter((_, index) => keep[index]);
}

/// 表示用に間引いたトラックを返す(元の点のオブジェクトをそのまま残す)。
/// 時間ギャップの切れ目をまたいで直線化しないよう、区間ごとに間引く
export function simplifyTrack<
  T extends { latitude: number; longitude: number; recorded_at: string },
>(points: T[], tolerance = TRACK_SIMPLIFY_TOLERANCE_M): T[] {
  if (points.length <= 2) {
    return points;
  }
  let current = tolerance;
  let result = points;
  // 極端に密な記録でも渡す点数が青天井にならないよう、上限を超えたら粗くして引き直す
  for (let attempt = 0; attempt < 5; attempt++) {
    result = splitByTimeGap(points).flatMap((segment) =>
      simplifySegment(segment, current),
    );
    if (result.length <= TRACK_MAX_POINTS) {
      break;
    }
    current *= 2;
  }
  return result;
}
