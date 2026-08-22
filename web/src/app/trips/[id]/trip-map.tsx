"use client";

import {
  MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { boundingBox, splitByTimeGap } from "@/lib/geo";

// バンドラ(Turbopack)経由だと maplibre が自身のワーカーを解決できないため、
// public/ に置いたワーカー(npm run copy-maplibre-worker が配置)を明示する
setWorkerUrl("/maplibre-gl-worker.mjs");

type TrackPoint = {
  latitude: number;
  longitude: number;
  recorded_at: string;
};

type MediaMarker = {
  id: string;
  type: "photo" | "video";
  latitude: number;
  longitude: number;
};

// OpenFreeMap のベクタタイル。登録・API キー不要で本番利用可、帰属表記はスタイル側に
// 含まれる。選定経緯は docs/plans/archive/web-map-tiles-production.md
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function TripMap({
  points,
  media = [],
}: {
  points: TrackPoint[];
  media?: MediaMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const bounds = boundingBox(points);
    if (!container || !bounds) {
      return;
    }

    const map = new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 48, maxZoom: 16 },
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }));

    map.on("error", (e) => console.error("[TripMap]", e.error ?? e));

    map.on("load", () => {
      // GPS 切断・記録停止中を線で結ばないよう、時間ギャップで区間分けして描く
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiLineString",
            coordinates: splitByTimeGap(points).map((segment) =>
              segment.map((p) => [p.longitude, p.latitude]),
            ),
          },
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2563eb", "line-width": 4 },
      });
    });

    const start = points[0];
    new Marker({ color: "#16a34a" })
      .setLngLat([start.longitude, start.latitude])
      .addTo(map);
    if (points.length >= 2) {
      const end = points[points.length - 1];
      new Marker({ color: "#dc2626" })
        .setLngLat([end.longitude, end.latitude])
        .addTo(map);
    }

    // 撮影地点のサムネイルマーカー(クリックで原本を開く)
    for (const m of media) {
      const anchor = document.createElement("a");
      anchor.href = `/media/${m.id}`;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      if (m.type === "photo") {
        const img = document.createElement("img");
        img.src = `/media/${m.id}`;
        img.alt = "";
        img.className =
          "h-10 w-10 rounded-md border-2 border-white object-cover shadow-md";
        anchor.appendChild(img);
      } else {
        anchor.className =
          "flex h-10 w-10 items-center justify-center rounded-md border-2 border-white bg-zinc-900/80 text-white shadow-md";
        anchor.textContent = "▶";
      }
      new Marker({ element: anchor })
        .setLngLat([m.longitude, m.latitude])
        .addTo(map);
    }

    return () => {
      map.remove();
    };
  }, [points, media]);

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
    />
  );
}
