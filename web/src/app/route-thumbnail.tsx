import type { Coordinate } from "@/lib/plan-map";

// 一覧に出すルートのサムネイル(iOS の RouteThumbnail と同じ見せ方)。
// 行の数だけ地図(WebGL)を作ると重いので、地図タイルは読まず形だけを SVG で描く

const WIDTH = 96;
const HEIGHT = 96;
const INSET = 14;

/** 座標列を描画領域に収まる点列へ写す。経度は緯度による横の縮みを補正する */
function layout(points: Coordinate[]): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const latitudes = points.map((p) => p.latitude);
  const longitudes = points.map((p) => p.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  const shrink = Math.cos((((minLatitude + maxLatitude) / 2) * Math.PI) / 180);
  const spanLatitude = Math.max(maxLatitude - minLatitude, 0.0001);
  const spanLongitude = Math.max((maxLongitude - minLongitude) * shrink, 0.0001);
  const scale = Math.min(
    (WIDTH - INSET * 2) / spanLongitude,
    (HEIGHT - INSET * 2) / spanLatitude,
  );
  const originX = (WIDTH - spanLongitude * scale) / 2;
  const originY = (HEIGHT - spanLatitude * scale) / 2;

  return points.map((point) => ({
    x: originX + (point.longitude - minLongitude) * shrink * scale,
    // 北が上になるよう緯度は反転する
    y: originY + (maxLatitude - point.latitude) * scale,
  }));
}

export function RouteThumbnail({
  points,
  /** 記録済み(--done) / これから(--accent) */
  color = "var(--accent)",
  className = "",
}: {
  points: Coordinate[];
  color?: string;
  className?: string;
}) {
  const laid = layout(points);
  const first = laid[0];
  const last = laid[laid.length - 1];
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      className={`bg-raised ${className}`}
      aria-hidden
    >
      {laid.length >= 2 && (
        <polyline
          points={laid.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {first && (
        <>
          <circle cx={first.x} cy={first.y} r={5} fill="var(--surface)" />
          <circle cx={first.x} cy={first.y} r={3.5} fill="var(--done)" />
        </>
      )}
      {last && laid.length >= 2 && (
        <>
          <circle cx={last.x} cy={last.y} r={5} fill="var(--surface)" />
          <circle cx={last.x} cy={last.y} r={3.5} fill={color} />
        </>
      )}
      {laid.length === 0 && (
        <text
          x={WIDTH / 2}
          y={HEIGHT / 2 + 4}
          textAnchor="middle"
          fill="var(--border)"
          fontSize="11"
        >
          no route
        </text>
      )}
    </svg>
  );
}
