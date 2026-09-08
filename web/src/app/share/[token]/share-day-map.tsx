"use client";

import type { Feature, MultiLineString } from "geojson";
import { GeoJSONSource, MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLazyMount } from "./use-lazy-mount";
import { CHECKPOINT_COLORS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { boundingBox, splitByTimeGap } from "@/lib/geo";
import { mapStyle } from "@/lib/maplibre-setup";
import {
  buildLegs,
  legLines,
  type ResolvedLeg,
  type RoutePoint,
} from "@/lib/route-legs";
import type { CheckpointMarker } from "@/lib/trip-plan";

// 共有ページの日カードに載せる、その日だけの地図。
// 記録した経路(緑の実線)・プランのルート(青の破線)・チェックポイントを、
// 前泊地を起点にした範囲で表示する。操作は受け付けない(ページのスクロールを奪わない)。
//
// 道路形状のレグは SSR で渡されたキャッシュ済みの分だけを使い、未解決レグは直線で描く。
// 公開経路(Cloudflare Access を Bypass する /share/*)から Server Action を呼ばせないため

const ROUTE_SOURCE = "day-plan-route";
const TRACK_SOURCE = "day-track";

function lineFeature(lines: [number, number][][]): Feature<MultiLineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiLineString", coordinates: lines },
  };
}

export type DayTrackPoint = {
  latitude: number;
  longitude: number;
  recorded_at: string;
};

export function ShareDayMap({
  markers,
  anchor,
  track,
  cachedLegs,
  className,
}: {
  markers: CheckpointMarker[];
  anchor: RoutePoint | null;
  track: DayTrackPoint[];
  cachedLegs: Record<string, ResolvedLeg>;
  className?: string;
}) {
  // 日数の多い旅行でも同時に生きる地図(= WebGL コンテキスト)を数枚に抑える。
  // 未マウント時も枠だけ同じ高さで出しておきレイアウトを揺らさない
  const { ref, visible } = useLazyMount<HTMLDivElement>();
  return (
    <div ref={ref} className={className}>
      {visible && (
        <DayMapCanvas
          markers={markers}
          anchor={anchor}
          track={track}
          cachedLegs={cachedLegs}
        />
      )}
    </div>
  );
}

function DayMapCanvas({
  markers,
  anchor,
  track,
  cachedLegs,
}: {
  markers: CheckpointMarker[];
  anchor: RoutePoint | null;
  track: DayTrackPoint[];
  cachedLegs: Record<string, ResolvedLeg>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  const planLines = useMemo(() => {
    const legs = buildLegs({ start: anchor, points: markers });
    return legLines(legs, cachedLegs);
  }, [anchor, markers, cachedLegs]);

  useEffect(() => {
    const container = containerRef.current;
    // 前泊地とその日の記録も収まる範囲にする
    const bounds = boundingBox([
      ...(anchor ? [anchor] : []),
      ...markers,
      ...track,
    ]);
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
        fitBoundsOptions: { padding: 32, maxZoom: 15 },
        attributionControl: { compact: true },
        // ページ内に日数ぶん並ぶので、スクロール・ピンチを奪わせない
        interactive: false,
      });
      setup(map);
    });

    function setup(map: MapLibreMap) {
      mapRef.current = map;
      map.on("error", (e) => console.error("[ShareDayMap]", e.error ?? e));

      const addLayers = () => {
        // プラン(破線)を先に敷き、記録(実線)を上に重ねる
        map.addSource(ROUTE_SOURCE, { type: "geojson", data: lineFeature([]) });
        map.addLayer({
          id: "day-plan-line",
          type: "line",
          source: ROUTE_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#5AA9E6",
            "line-width": 3,
            "line-opacity": 0.9,
            "line-dasharray": [2, 2],
          },
        });
        // GPS 切断・記録停止中を線で結ばないよう、時間ギャップで区間分けして描く
        map.addSource(TRACK_SOURCE, {
          type: "geojson",
          data: lineFeature(
            splitByTimeGap(track).map((segment) =>
              segment.map((p) => [p.longitude, p.latitude]),
            ),
          ),
        });
        map.addLayer({
          id: "day-track-line",
          type: "line",
          source: TRACK_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#7BD389", "line-width": 3 },
        });
        setReady(true);
      };
      if (map.isStyleLoaded()) {
        addLayers();
      } else {
        map.on("style.load", addLayers);
      }

      if (anchor) {
        // 前泊地は控えめな灰色の点で出す(その日の立ち寄り先と区別する)
        const dot = document.createElement("div");
        dot.style.cssText =
          "width:10px;height:10px;border-radius:9999px;background:#93a0ae;border:2px solid #101419;";
        dot.title = "前泊地";
        new Marker({ element: dot })
          .setLngLat([anchor.longitude, anchor.latitude])
          .addTo(map);
      }

      for (const marker of markers) {
        const pin = new Marker({
          color: CHECKPOINT_COLORS[marker.type],
          scale: 0.7,
        })
          .setLngLat([marker.longitude, marker.latitude])
          .addTo(map);
        // 名前はユーザー入力なので setHTML ではなく title(textContent 相当)で渡す
        pin.getElement().title =
          `${CHECKPOINT_LABELS[marker.type]}: ${marker.name}`;
      }
    }

    return () => {
      cancelled = true;
      setReady(false);
      mapRef.current = null;
      map?.remove();
    };
  }, [markers, anchor, track]);

  // 初回の流し込み(地図は作り直さない)
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource(ROUTE_SOURCE);
    if (source instanceof GeoJSONSource) {
      source.setData(lineFeature(planLines));
    }
  }, [ready, planLines]);

  return <div ref={containerRef} className="h-full w-full" />;
}
