"use client";

import { MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { CHECKPOINT_COLORS } from "@/lib/checkpoint-style";
import { boundingBox } from "@/lib/geo";
import { mapStyle } from "@/lib/maplibre-setup";
import type { OutlineMapPoint } from "@/lib/outline-map";

// AI の日数・宿泊地候補 1 件のプレビュー地図(iOS の OutlineCandidateMap 相当)。
// 出発地 → 各泊 → 目的地をマーカーとポリラインで結ぶだけの操作不可の地図。
// 座標は AI の概算なのでおおよその位置(採用後に Google Maps のリンクで具体化する)

export function OutlineMap({ points }: { points: OutlineMapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const bounds = boundingBox(points);
    if (!container || !bounds) {
      return;
    }

    let map: MapLibreMap | null = null;
    let cancelled = false;
    void mapStyle().then((style) => {
      if (cancelled) return;
      map = new MapLibreMap({
        container,
        style,
        bounds,
        // 概算座標なので寄りすぎない。1 点だけのときも街の広さで収まる
        fitBoundsOptions: { padding: 40, maxZoom: 9 },
        attributionControl: { compact: true },
        interactive: false,
      });
      setup(map);
    });

    function setup(map: MapLibreMap) {
    map.on("error", (e) => console.error("[OutlineMap]", e.error ?? e));

    if (points.length >= 2) {
      // スタイルをオブジェクトで渡すと load が購読前に終わっていることがある
      const addOutline = () => {
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
          paint: { "line-color": "#5AA9E6", "line-width": 3 },
        });
      };
      if (map.isStyleLoaded()) {
        addOutline();
      } else {
        map.on("style.load", addOutline);
      }
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
    }

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points]);

  return (
    <div
      ref={containerRef}
      className="h-40 w-full overflow-hidden rounded-md border border-border"
    />
  );
}
