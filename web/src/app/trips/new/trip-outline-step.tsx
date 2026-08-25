"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OutlineCandidates } from "../outline-candidates";
import {
  adoptTripOutlineAction,
  startTripOutlineAction,
} from "../outline-actions";
import { useOutlineJob } from "../use-outline-job";
import type { TripOutlineCandidate, TripOutlineInput } from "@/lib/ai";

// 旅行を作成した直後の「日数と宿泊地の候補」ステップ(iOS の TripCreateView 後半と同じ)。
// 旅行は作成済みなので、スキップしても旅行画面へ進める。
// 生成は 1 分前後かかるため ai_jobs にジョブを登録して 3 秒間隔でポーリングする
// (ジョブの登録は作成ボタンの延長で 1 回だけ行い、ここでは結果を待つだけ)

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
  const { suggestion, error: jobError } = useOutlineJob(jobId);
  // ジョブの失敗とは別に、開始・採用の失敗もここに出す
  const [actionError, setActionError] = useState<string | null>(initialError);
  const [adopting, setAdopting] = useState(false);
  const error = actionError ?? jobError;

  const retry = async () => {
    setActionError(null);
    setJobId(null);
    const result = await startTripOutlineAction(input);
    if (result.ok) {
      setJobId(result.jobId);
      return;
    }
    setActionError(result.error);
  };

  const adopt = async (candidate: TripOutlineCandidate) => {
    setAdopting(true);
    setActionError(null);
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
    setActionError(result.error);
    setAdopting(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">日数と宿泊地の候補</h2>
        <button
          type="button"
          onClick={() => router.push(`/trips/${tripId}`)}
          className="rounded-md border border-border px-3 py-1 text-sm"
        >
          スキップ
        </button>
      </div>

      {error && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="rounded-md border border-border px-3 py-1 text-sm"
          >
            再試行
          </button>
        </div>
      )}

      {!error && !suggestion && (
        <p className="text-sm text-muted">
          候補を作成中…(1 分ほどかかります)
        </p>
      )}

      {suggestion && (
        <OutlineCandidates
          suggestion={suggestion}
          departure={{
            name: input.departure,
            latitude: input.departureLatitude,
            longitude: input.departureLongitude,
          }}
          destinationName={input.destination}
          adopting={adopting}
          onAdopt={adopt}
        />
      )}

      <p className="text-xs text-muted">
        旅行は作成済みです。スキップしても「日を追加」や「続きの行程を提案」で後から日程を組めます。地図はおおよその位置で、採用後は通常の編集で調整でき、宿の位置は
        Google Maps のリンクで具体化できます
      </p>
    </div>
  );
}
