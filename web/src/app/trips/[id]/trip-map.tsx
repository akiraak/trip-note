"use client";

import { MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { CHECKPOINT_COLORS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { boundingBox, splitByTimeGap } from "@/lib/geo";
import { googleMapsSearchUrl } from "@/lib/google-maps";
import { MAP_STYLE_URL } from "@/lib/maplibre-setup";
import type { CheckpointType } from "@/lib/types";

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

type CheckpointMarker = {
  id: string;
  type: CheckpointType;
  name: string;
  latitude: number;
  longitude: number;
};

export function TripMap({
  points,
  media = [],
  checkpoints = [],
}: {
  points: TrackPoint[];
  media?: MediaMarker[];
  checkpoints?: CheckpointMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    // プランのみ(記録点なし)の旅行でもチェックポイントが収まる範囲を表示する
    const bounds = boundingBox([...points, ...checkpoints]);
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

    if (points.length > 0) {
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
    }

    // プランのチェックポイント(種別ごとの色。クリックで名前と Google Maps リンクを表示)
    for (const checkpoint of checkpoints) {
      // 名前はユーザー入力なので setHTML ではなく DOM 組み立てで渡す
      const popupContent = document.createElement("div");
      const title = document.createElement("div");
      title.textContent = `${CHECKPOINT_LABELS[checkpoint.type]}: ${checkpoint.name}`;
      popupContent.appendChild(title);
      const link = document.createElement("a");
      link.href = googleMapsSearchUrl(checkpoint.latitude, checkpoint.longitude);
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Google Maps で開く";
      link.className = "underline";
      popupContent.appendChild(link);
      new Marker({ color: CHECKPOINT_COLORS[checkpoint.type] })
        .setLngLat([checkpoint.longitude, checkpoint.latitude])
        .setPopup(
          new Popup({ closeButton: false, offset: 24 }).setDOMContent(
            popupContent,
          ),
        )
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
  }, [points, media, checkpoints]);

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
    />
  );
}
