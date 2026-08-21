"use client";

import {
  MapLibreMap,
  Marker,
  NavigationControl,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { boundingBox } from "@/lib/geo";

type LatLng = { latitude: number; longitude: number };

// OSM 公式ラスタタイル。API キー不要だが大量アクセスには不適のため、
// 本番運用時はタイルソースを差し替える(docs/specs/phase3-map-display.md)
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export function TripMap({ points }: { points: LatLng[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const bounds = boundingBox(points);
    if (!container || !bounds) {
      return;
    }

    const map = new MapLibreMap({
      container,
      style: OSM_STYLE,
      bounds,
      fitBoundsOptions: { padding: 48, maxZoom: 16 },
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }));

    map.on("load", () => {
      map.addSource("route", {
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

    return () => {
      map.remove();
    };
  }, [points]);

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
    />
  );
}
