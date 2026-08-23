"use client";

import type { Feature, MultiLineString } from "geojson";
import { GeoJSONSource, MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLazyMount } from "./use-lazy-mount";
import { CHECKPOINT_COLORS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { boundingBox } from "@/lib/geo";
import { MAP_STYLE_URL } from "@/lib/maplibre-setup";
import type { Coordinate, DayMapPoint } from "@/lib/plan-map";
import { legLines, type Leg, type ResolvedLeg } from "@/lib/route-legs";

// 日カードのミニ地図(iOS の TripDayMiniMap 相当)。その日のチェックポイントを
// 訪問順のマーカーとポリラインで表示し、anchor(前泊地)があればそこを線の起点にする。
// ルートはレグごとに描き、解決済みなら道路形状・未解決なら端点を結ぶ直線になる

const ROUTE_SOURCE = "day-route";

function routeFeature(lines: [number, number][][]): Feature<MultiLineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiLineString", coordinates: lines },
  };
}

export function DayMap({
  points,
  anchor,
  legs,
  resolved,
}: {
  points: DayMapPoint[];
  anchor: Coordinate | null;
  legs: Leg[];
  resolved: Record<string, ResolvedLeg>;
}) {
  // 日数の多い旅行でも同時に生きる地図(= WebGL コンテキスト)を数枚に抑える。
  // 未マウント時も枠だけ同じ高さで出しておきレイアウトを揺らさない
  const { ref, visible } = useLazyMount<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="h-40 w-full overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
    >
      {visible && (
        <DayMapCanvas
          points={points}
          anchor={anchor}
          legs={legs}
          resolved={resolved}
        />
      )}
    </div>
  );
}

function DayMapCanvas({
  points,
  anchor,
  legs,
  resolved,
}: {
  points: DayMapPoint[];
  anchor: Coordinate | null;
  legs: Leg[];
  resolved: Record<string, ResolvedLeg>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  const lines = useMemo(() => legLines(legs, resolved), [legs, resolved]);

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
    mapRef.current = map;
    map.on("error", (e) => console.error("[DayMap]", e.error ?? e));

    // load はタイルが出そろうまで発火しないので、ソース/レイヤの追加は
    // スタイルが使えるようになった時点(style.load)で行う
    map.on("style.load", () => {
      // 中身は下の effect が ready を見て入れる(lines をこの effect の依存に入れると
      // レグ解決のたびに地図ごと作り直してちらつく)
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: routeFeature([]),
      });
      map.addLayer({
        id: "day-route-line",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2563eb", "line-width": 3 },
      });
      setReady(true);
    });

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
      setReady(false);
      mapRef.current = null;
      map.remove();
    };
  }, [points, anchor]);

  // 初回の流し込みと、レグが解決したときの差し替え(地図は作り直さない)
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource(ROUTE_SOURCE);
    if (source instanceof GeoJSONSource) {
      source.setData(routeFeature(lines));
    }
  }, [ready, lines]);

  return <div ref={containerRef} className="h-full w-full" />;
}
