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

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}
