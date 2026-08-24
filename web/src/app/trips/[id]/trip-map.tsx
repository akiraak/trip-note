"use client";

import type { Feature, MultiLineString } from "geojson";
import {
  GeoJSONSource,
  MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouteLegs } from "./use-route-legs";
import { CHECKPOINT_COLORS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { boundingBox, splitByTimeGap } from "@/lib/geo";
import { googleMapsSearchUrl } from "@/lib/google-maps";
import { mapStyle } from "@/lib/maplibre-setup";
import {
  buildLegs,
  legLines,
  type ResolvedLeg,
  type RoutePoint,
} from "@/lib/route-legs";
import type { CheckpointType } from "@/lib/types";

const PLAN_SOURCE = "plan-route";

function planFeature(lines: [number, number][][]): Feature<MultiLineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiLineString", coordinates: lines },
  };
}

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
  planRoute = [],
  cachedLegs,
  focus = null,
  className = "h-80 w-full",
}: {
  points: TrackPoint[];
  media?: MediaMarker[];
  checkpoints?: CheckpointMarker[];
  /** プランのルート座標列(日付順 → 日内 sort_order 順。checkpoints の並びとは別) */
  planRoute?: RoutePoint[];
  /** SSR 時点でキャッシュ済みだったレグ(page.tsx の readCachedLegs) */
  cachedLegs?: Record<string, ResolvedLeg>;
  /** 寄せたい範囲(日を選んだときのその日の範囲)。null なら旅行全体のまま */
  focus?: [[number, number], [number, number]] | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  const planLegs = useMemo(() => buildLegs({ points: planRoute }), [planRoute]);
  const resolved = useRouteLegs(planLegs, cachedLegs);
  const planLines = useMemo(
    () => legLines(planLegs, resolved),
    [planLegs, resolved],
  );

  useEffect(() => {
    const container = containerRef.current;
    // プランのみ(記録点なし)の旅行でもチェックポイントが収まる範囲を表示する
    const bounds = boundingBox([...points, ...checkpoints]);
    if (!container || !bounds) {
      return;
    }

    // スタイルは加工済みのものを使う(取得は初回だけ。maplibre-setup を参照)
    let map: MapLibreMap | null = null;
    let cancelled = false;
    void mapStyle().then((style) => {
      if (cancelled) return;
      map = new MapLibreMap({
        container,
        style,
        bounds,
        fitBoundsOptions: { padding: 48, maxZoom: 16 },
        attributionControl: { compact: true },
        // モバイルは地図が画面上部を占めるので、1 本指のスワイプはページのスクロールに渡す
        cooperativeGestures:
          typeof window !== "undefined" && window.innerWidth < 1024,
      });
      setup(map);
    });

    function setup(map: MapLibreMap) {
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }));

    map.on("error", (e) => console.error("[TripMap]", e.error ?? e));

    // load はタイルが出そろうまで発火しないので、ソース/レイヤの追加は
    // スタイルが使えるようになった時点で行う。スタイルを URL ではなく
    // オブジェクトで渡すと style.load が購読前に終わっていることがあるため、
    // 済んでいれば直接呼ぶ
    const addRouteLayers = () => {
      // これからのプラン(破線)。実績トラック(実線)より先に追加して下に敷く。
      // レグごとに、解決済みなら道路形状・未解決なら端点を結ぶ直線を描く。
      // 中身は下の effect が ready を見て入れる(planLines をこの effect の依存に
      // 入れるとレグ解決のたびに地図ごと作り直してちらつく)
      map.addSource(PLAN_SOURCE, {
        type: "geojson",
        data: planFeature([]),
      });
      map.addLayer({
        id: "plan-route-line",
        type: "line",
        source: PLAN_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          // これからのプランは accent(青)の破線、記録済みは done(緑)の実線
          "line-color": "#5AA9E6",
          "line-width": 3.5,
          "line-opacity": 0.9,
          "line-dasharray": [2, 2],
        },
      });
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
        paint: { "line-color": "#7BD389", "line-width": 4 },
      });
      setReady(true);
    };
    if (map.isStyleLoaded()) {
      addRouteLayers();
    } else {
      map.on("style.load", addRouteLayers);
    }

    if (points.length > 0) {
      const start = points[0];
      new Marker({ color: "#7BD389" })
        .setLngLat([start.longitude, start.latitude])
        .addTo(map);
      if (points.length >= 2) {
        const end = points[points.length - 1];
        new Marker({ color: "#FF7C6B" })
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
          "flex h-10 w-10 items-center justify-center rounded-md border-2 border-white bg-background/80 text-white shadow-md";
        anchor.textContent = "▶";
      }
      new Marker({ element: anchor })
        .setLngLat([m.longitude, m.latitude])
        .addTo(map);
    }
    }

    return () => {
      cancelled = true;
      setReady(false);
      mapRef.current = null;
      map?.remove();
    };
  }, [points, media, checkpoints]);

  // 初回の流し込みと、レグが解決したときの差し替え(地図は作り直さない)
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource(PLAN_SOURCE);
    if (source instanceof GeoJSONSource) {
      source.setData(planFeature(planLines));
    }
  }, [ready, planLines]);

  // 日を選んだらその日の範囲へ寄る(選択を外したら旅行全体へ戻す)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const bounds = focus ?? boundingBox([...points, ...checkpoints]);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 600 });
  }, [ready, focus, points, checkpoints]);

  return <div ref={containerRef} className={className} />;
}
