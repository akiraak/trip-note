"use client";

import { MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { CHECKPOINT_COLORS } from "@/lib/checkpoint-style";
import { boundingBox } from "@/lib/geo";
import type { OutlineMapPoint } from "@/lib/outline-map";

// AI の日数・宿泊地候補 1 件のプレビュー地図(iOS の OutlineCandidateMap 相当)。
// 出発地 → 各泊 → 目的地をマーカーとポリラインで結ぶだけの操作不可の地図。
// 座標は AI の概算なのでおおよその位置(採用後に Google Maps のリンクで具体化する)

// バンドラ(Turbopack)経由だと maplibre が自身のワーカーを解決できないため、
// public/ に置いたワーカー(npm run copy-maplibre-worker が配置)を明示する
setWorkerUrl("/maplibre-gl-worker.mjs");

// trip-map.tsx と同じ OpenFreeMap のベクタタイル(登録・API キー不要)
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function OutlineMap({ points }: { points: OutlineMapPoint[] }) {
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
      // 概算座標なので寄りすぎない。1 点だけのときも街の広さで収まる
      fitBoundsOptions: { padding: 40, maxZoom: 9 },
      attributionControl: { compact: true },
      interactive: false,
    });
    map.on("error", (e) => console.error("[OutlineMap]", e.error ?? e));

    if (points.length >= 2) {
      map.on("load", () => {
        map.addSource("outline", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: points.map((p) => [p.longitude, p.latitude]),
            },
          },
        });
        map.addLayer({
          id: "outline-line",
          type: "line",
          source: "outline",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#2563eb", "line-width": 3 },
        });
      });
    }

    for (const point of points) {
      const marker = new Marker({
        color: CHECKPOINT_COLORS[point.type],
        scale: 0.7,
      })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
      // ラベルはユーザー入力・AI 出力なので textContent 相当の title で渡す
      marker.getElement().title = point.label;
    }

    return () => {
      map.remove();
    };
  }, [points]);

  return (
    <div
      ref={containerRef}
      className="h-40 w-full overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
    />
  );
}
