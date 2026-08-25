"use client";

import { OutlineMap } from "./outline-map";
import type { TripOutlineCandidate, TripOutlineSuggestion } from "@/lib/ai";
import { outlineMapPoints } from "@/lib/outline-map";

// AI の日数・宿泊地候補(/api/ai/trip-outline の応答)の一覧。
// 旅行を作成した直後の候補ステップ(trips/new)と、既存プランの続きを足す
// 旅行詳細の入力フォーム(trips/[id]/plan-extension.tsx)の両方から使う。
// iOS の TripOutlineCandidates と同じ表示内容

/** 地図を描く候補の数(WebGL コンテキストを候補ぶん張るので上限を設ける) */
const MAX_MAPS = 3;

/** 例: 「2泊3日・泊: 松本 → 上高地」「1日間(日帰り)」(iOS の summary(of:) と同じ) */
function summary(candidate: TripOutlineCandidate): string {
  const days =
    candidate.nights.length === 0
      ? `${candidate.dayCount}日間(日帰り)`
      : `${candidate.nights.length}泊${candidate.dayCount}日`;
  const areas = candidate.nights.map((night) => night.area).filter(Boolean);
  return areas.length === 0 ? days : `${days}・泊: ${areas.join(" → ")}`;
}

export type OutlinePlace = {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function OutlineCandidates({
  suggestion,
  departure,
  destinationName,
  adopting,
  onAdopt,
}: {
  suggestion: TripOutlineSuggestion;
  /** 出発地(プレビュー地図の始点。座標が無ければ地図には出ない) */
  departure: OutlinePlace | null;
  /** 到着地の名前(地図のラベル。座標は suggestion 側) */
  destinationName: string | null;
  adopting: boolean;
  onAdopt: (candidate: TripOutlineCandidate) => void;
}) {
  return (
    <>
      {suggestion.candidates.map((candidate, index) => {
        // 出発地 → 各泊 → 目的地。座標が取れた点だけを地図に出す
        const points =
          index < MAX_MAPS
            ? outlineMapPoints({
                departure,
                nights: candidate.nights,
                destination: {
                  name: destinationName,
                  latitude: suggestion.destinationLatitude,
                  longitude: suggestion.destinationLongitude,
                },
              })
            : [];
        return (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-lg border border-border p-3"
          >
            <div>
              <p className="font-medium">{candidate.title}</p>
              <p className="text-sm text-muted">{summary(candidate)}</p>
            </div>
            {points.length > 0 && <OutlineMap points={points} />}
            {candidate.nights.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-sm">
                {candidate.nights.map((night, i) => (
                  <li key={i} className="flex items-baseline gap-1">
                    <span aria-hidden>🛏</span>
                    <span>
                      {i + 1}泊目 {night.area}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {night.name}
                      {night.note ? ` · ${night.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <button
                type="button"
                disabled={adopting}
                onClick={() => onAdopt(candidate)}
                className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
              >
                {adopting ? "追加中…" : "この候補を採用"}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
