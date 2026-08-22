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
