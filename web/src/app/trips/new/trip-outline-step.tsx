"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  adoptTripOutlineAction,
  pollTripOutlineAction,
  startTripOutlineAction,
} from "./actions";
import type {
  TripOutlineCandidate,
  TripOutlineInput,
  TripOutlineSuggestion,
} from "@/lib/ai";

// 旅行を作成した直後の「日数と宿泊地の候補」ステップ(iOS の TripCreateView 後半と同じ)。
// 旅行は作成済みなので、スキップしても旅行画面へ進める。
// 生成は 1 分前後かかるため ai_jobs にジョブを登録して 3 秒間隔でポーリングする
// (ジョブの登録は作成ボタンの延長で 1 回だけ行い、ここでは結果を待つだけ)

const POLL_INTERVAL_MS = 3000;

/** 例: 「2泊3日・泊: 松本 → 上高地」「1日間(日帰り)」(iOS の summary(of:) と同じ) */
function summary(candidate: TripOutlineCandidate): string {
  const days =
    candidate.nights.length === 0
      ? `${candidate.dayCount}日間(日帰り)`
      : `${candidate.nights.length}泊${candidate.dayCount}日`;
  const areas = candidate.nights.map((night) => night.area).filter(Boolean);
  return areas.length === 0 ? days : `${days}・泊: ${areas.join(" → ")}`;
}

export function TripOutlineStep({
  tripId,
  input,
  initialJobId,
  initialError,
}: {
  tripId: string;
  input: TripOutlineInput;
  initialJobId: string | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJobId);
  const [suggestion, setSuggestion] = useState<TripOutlineSuggestion | null>(
    null,
  );
  const [error, setError] = useState<string | null>(initialError);
  const [adopting, setAdopting] = useState(false);

  useEffect(() => {
    if (!jobId || suggestion) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const result = await pollTripOutlineAction(jobId);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.status === "succeeded") {
        setSuggestion(result.suggestion);
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, suggestion]);

  const retry = async () => {
    setError(null);
    setJobId(null);
    const result = await startTripOutlineAction(input);
    if (result.ok) {
      setJobId(result.jobId);
      return;
    }
    setError(result.error);
  };

  const adopt = async (candidate: TripOutlineCandidate) => {
    setAdopting(true);
    setError(null);
    const result = await adoptTripOutlineAction(tripId, {
      dayCount: candidate.dayCount,
      nights: candidate.nights.map((night) => ({
        name: night.name,
        note: night.note,
        latitude: night.latitude,
        longitude: night.longitude,
      })),
      destinationLatitude: suggestion?.destinationLatitude ?? null,
      destinationLongitude: suggestion?.destinationLongitude ?? null,
    });
    if (result.ok) {
      router.push(`/trips/${tripId}`);
      return;
    }
    setError(result.error);
    setAdopting(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">日数と宿泊地の候補</h2>
        <button
          type="button"
          onClick={() => router.push(`/trips/${tripId}`)}
          className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
        >
          スキップ
        </button>
      </div>

      {error && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
          >
            再試行
          </button>
        </div>
      )}

      {!error && !suggestion && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          候補を作成中…(1 分ほどかかります)
        </p>
      )}

      {suggestion?.candidates.map((candidate, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <div>
            <p className="font-medium">{candidate.title}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {summary(candidate)}
            </p>
          </div>
          {candidate.nights.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-sm">
              {candidate.nights.map((night, i) => (
                <li key={i} className="flex items-baseline gap-1">
                  <span aria-hidden>🛏</span>
                  <span>
                    {i + 1}泊目 {night.area}
                  </span>
                  <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
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
              onClick={() => adopt(candidate)}
              className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
            >
              {adopting ? "追加中…" : "この候補を採用"}
            </button>
          </div>
        </div>
      ))}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        旅行は作成済みです。スキップしても「日を追加」や AI
        行程提案で後から日程を組めます。採用後は通常の編集で調整でき、宿の位置は
        Google Maps のリンクで具体化できます
      </p>
    </div>
  );
}
