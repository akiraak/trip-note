"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { PlanSection, type PlanDay } from "./plan-section";
import { TripMap } from "./trip-map";
import { boundingBox } from "@/lib/geo";
import { dayMapPoints } from "@/lib/plan-map";
import type { ResolvedLeg, RoutePoint } from "@/lib/route-legs";
import type { CheckpointType, TripStatus } from "@/lib/types";

// 旅行詳細の骨組み(案 C「ルートキャンバス」)。
// PC は画面いっぱいの地図 + 左の固定パネル、モバイルは上が地図で下がパネル。
// 日の見出しを押すとその日の範囲へ地図が寄る(選択は client 側の状態なのでここが持つ)

export function TripCanvas({
  title,
  status,
  points,
  media,
  checkpoints,
  planRoute,
  cachedLegs,
  tripId,
  days,
  transport,
  aiDefaults,
  header,
  footer,
}: {
  title: string;
  status: TripStatus;
  points: { latitude: number; longitude: number; recorded_at: string }[];
  media: {
    id: string;
    type: "photo" | "video";
    latitude: number;
    longitude: number;
  }[];
  checkpoints: {
    id: string;
    type: CheckpointType;
    name: string;
    latitude: number;
    longitude: number;
  }[];
  planRoute: RoutePoint[];
  cachedLegs?: Record<string, ResolvedLeg>;
  tripId: string;
  days: PlanDay[];
  transport: string | null;
  aiDefaults: { startDate: string; dayCount: number; departure: string };
  /** パネルの上部(旅行の情報・編集)。server component 側で組んだものを差す */
  header: ReactNode;
  /** パネルの下部(メディア・タイムライン・削除) */
  footer: ReactNode;
}) {
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);

  // 選んだ日の範囲(前泊地を含む)。選んでいなければ null = 旅行全体
  const focus = useMemo(() => {
    if (!selectedDayId) return null;
    const index = days.findIndex((day) => day.id === selectedDayId);
    if (index < 0) return null;
    const map = dayMapPoints(days)[index];
    const coordinates = map.anchor ? [map.anchor, ...map.points] : map.points;
    return boundingBox(coordinates);
  }, [selectedDayId, days]);

  return (
    // PC は画面の高さに収めて中だけスクロールする。flex アイテムのままだと
    // flex-basis が h-dvh より優先されて高さが伸びてしまうので lg:flex-none を付ける
    <div className="flex flex-1 flex-col lg:h-dvh lg:flex-none lg:flex-row-reverse lg:overflow-hidden">
      {/* モバイルは地図を上に貼り付けたまま、パネルがその上にせり上がる */}
      <div className="sticky top-0 h-[46dvh] shrink-0 lg:relative lg:h-full lg:flex-1">
        <TripMap
          points={points}
          media={media}
          checkpoints={checkpoints}
          planRoute={planRoute}
          cachedLegs={cachedLegs}
          focus={focus}
          className="h-full w-full"
        />
        {/* 地図の上に重ねる見出し(戻る・旅行名・状態) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-background via-background/70 to-transparent px-4 pt-3 pb-10">
          <Link
            href="/"
            className="pointer-events-auto grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface/90 hover:border-accent"
            aria-label="旅行一覧へ戻る"
          >
            ←
          </Link>
          <span className="truncate font-medium">{title}</span>
          {status === "in_progress" && (
            <span className="tabular shrink-0 rounded-full bg-done/15 px-2 py-0.5 text-[11px] text-done">
              進行中
            </span>
          )}
          {status === "planning" && (
            <span className="tabular shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
              プラン中
            </span>
          )}
          {selectedDayId && (
            <button
              type="button"
              onClick={() => setSelectedDayId(null)}
              className="pointer-events-auto tabular ml-auto shrink-0 rounded-md border border-border bg-surface/90 px-2 py-1 text-xs text-muted hover:border-accent"
            >
              全体を表示
            </button>
          )}
        </div>
      </div>
      <aside className="relative z-10 -mt-5 flex w-full flex-col gap-5 rounded-t-2xl border-t border-border bg-surface px-4 pt-3 pb-10 lg:mt-0 lg:w-[440px] lg:shrink-0 lg:overflow-y-auto lg:rounded-none lg:border-t-0 lg:border-r lg:px-5 lg:pt-4">
        {/* モバイルは地図の上にせり上がるシートに見せる */}
        <span
          aria-hidden
          className="mx-auto -mt-1 h-1 w-10 rounded-full bg-border lg:hidden"
        />
        {header}
        <section className="flex flex-col gap-2">
          <h2 className="tabular text-xs tracking-[0.18em] text-muted uppercase">
            Plan
          </h2>
          <PlanSection
            tripId={tripId}
            days={days}
            transport={transport}
            aiDefaults={aiDefaults}
            cachedLegs={cachedLegs}
            selectedDayId={selectedDayId}
            onSelectDay={setSelectedDayId}
          />
        </section>
        {footer}
      </aside>
    </div>
  );
}
