"use client";

import { MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { useLazyMount } from "./use-lazy-mount";
import { CHECKPOINT_COLORS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { boundingBox } from "@/lib/geo";
import { MAP_STYLE_URL } from "@/lib/maplibre-setup";
import type { Coordinate, DayMapPoint } from "@/lib/plan-map";

// 日カードのミニ地図(iOS の TripDayMiniMap 相当)。その日のチェックポイントを
// 訪問順のマーカーとポリラインで表示し、anchor(前泊地)があればそこを線の起点にする。
// ルート線はこの段階では直線(道路形状は docs/plans/web-plan-route.md)。

export function DayMap({
  points,
  anchor,
}: {
  points: DayMapPoint[];
  anchor: Coordinate | null;
}) {
  // 日数の多い旅行でも同時に生きる地図(= WebGL コンテキスト)を数枚に抑える。
  // 未マウント時も枠だけ同じ高さで出しておきレイアウトを揺らさない
  const { ref, visible } = useLazyMount<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="h-40 w-full overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
    >
      {visible && <DayMapCanvas points={points} anchor={anchor} />}
    </div>
  );
}

function DayMapCanvas({
  points,
  anchor,
}: {
  points: DayMapPoint[];
  anchor: Coordinate | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    // 起点は前泊地から。地図の範囲もそれを含める
    const route = anchor ? [anchor, ...points] : points;
    const bounds = boundingBox(route);
    if (!container || !bounds) {
      return;
    }

    const map = new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 32, maxZoom: 15 },
      attributionControl: { compact: true },
      // ページ内に複数並ぶのでスクロール・ピンチを奪わせない
      // (ズームさせたくなったら cooperativeGestures を検討する)
      interactive: false,
    });
    map.on("error", (e) => console.error("[DayMap]", e.error ?? e));

    if (route.length >= 2) {
      map.on("load", () => {
        map.addSource("day-route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: route.map((p) => [p.longitude, p.latitude]),
            },
          },
        });
        map.addLayer({
          id: "day-route-line",
          type: "line",
          source: "day-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#2563eb", "line-width": 3 },
        });
      });
    }

    if (anchor) {
      // 前日からの出発点(小さなグレーの丸で控えめに)
      const dot = document.createElement("div");
      dot.className =
        "h-2.5 w-2.5 rounded-full border-2 border-white bg-zinc-500 shadow";
      dot.title = "前泊地";
      new Marker({ element: dot })
        .setLngLat([anchor.longitude, anchor.latitude])
        .addTo(map);
    }

    for (const point of points) {
      const marker = new Marker({
        color: CHECKPOINT_COLORS[point.type],
        scale: 0.7,
      })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
      // 名前はユーザー入力なので setHTML ではなく title(textContent 相当)で渡す
      marker.getElement().title =
        `${CHECKPOINT_LABELS[point.type]}: ${point.name}`;
    }

    return () => {
      map.remove();
    };
  }, [points, anchor]);

  return <div ref={containerRef} className="h-full w-full" />;
}
