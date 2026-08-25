"use client";

import { useEffect, useState } from "react";
import { pollTripOutlineAction } from "./outline-actions";
import type { TripOutlineSuggestion } from "@/lib/ai";

// 登録済みの候補生成ジョブ(ai_jobs)の完了待ち。生成は 1 分前後かかるため
// 接続を張りっぱなしにせずポーリングする(iOS の AIClient.runAIJob と同じ方式)

const POLL_INTERVAL_MS = 3000;

/** ポーリングの結果。どの jobId のものかを持たせ、jobId を張り替えたら
 *  前のジョブの結果は返さない(effect の中で state を消さずに済む) */
type JobResult = {
  jobId: string;
  suggestion: TripOutlineSuggestion | null;
  error: string | null;
};

/** jobId のジョブを 3 秒間隔で待つ。jobId が変わったら待ち直す(null なら何もしない) */
export function useOutlineJob(jobId: string | null): {
  suggestion: TripOutlineSuggestion | null;
  error: string | null;
} {
  const [result, setResult] = useState<JobResult | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const polled = await pollTripOutlineAction(jobId);
      if (cancelled) return;
      if (!polled.ok) {
        setResult({ jobId, suggestion: null, error: polled.error });
        return;
      }
      if (polled.status === "succeeded") {
        setResult({ jobId, suggestion: polled.suggestion, error: null });
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const current = result?.jobId === jobId ? result : null;
  return {
    suggestion: current?.suggestion ?? null,
    error: current?.error ?? null,
  };
}
