"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  parseTripOutlineSuggestion,
  type TripOutlineInput,
  type TripOutlineSuggestion,
} from "@/lib/ai";
import { createAiJob, getAiJob, runAiJob } from "@/lib/ai-jobs";
import { adoptTripOutline, type AdoptOutline } from "@/lib/plan";

// AI の日数・宿泊地候補の生成と採用。旅行の作成直後(trips/new)と
// 既存プランの続きの追加(trips/[id])の両方から使う。
// 生成は 1 分前後かかるので iOS と同じジョブ方式(ai_jobs)にする。
// ここでジョブを登録して即返し、生成は応答後の after() で実行、
// クライアントは pollTripOutlineAction でポーリングする。
// ページと同じ保護範囲で動くため Bearer 認証は使わない

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

export type StartJobResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string };

export async function startTripOutlineAction(
  input: TripOutlineInput,
): Promise<StartJobResult> {
  try {
    const job = createAiJob({
      id: randomUUID(),
      kind: "trip_outline",
      input,
    });
    if (job.status === "pending") {
      after(() => runAiJob(job.id));
    }
    return { ok: true, jobId: job.id };
  } catch (error) {
    return failure(error, "候補の作成に失敗しました");
  }
}

export type PollOutlineResult =
  | { ok: true; status: "pending" | "running" }
  | { ok: true; status: "succeeded"; suggestion: TripOutlineSuggestion }
  | { ok: false; error: string };

export async function pollTripOutlineAction(
  jobId: string,
): Promise<PollOutlineResult> {
  try {
    const job = getAiJob(jobId);
    if (!job) throw new Error("候補の生成が見つかりません");
    if (job.status === "failed") {
      throw new Error(job.error ?? "候補の作成に失敗しました");
    }
    if (job.status !== "succeeded") {
      return { ok: true, status: job.status };
    }
    return {
      ok: true,
      status: "succeeded",
      // result は保存済みの JSON なので、型の保証のためここで検証し直す
      suggestion: parseTripOutlineSuggestion(job.result),
    };
  } catch (error) {
    return failure(error, "候補の取得に失敗しました");
  }
}

export type AdoptOutlineResult = { ok: true } | { ok: false; error: string };

/** 候補を採用して trip_days / checkpoints を作る */
export async function adoptTripOutlineAction(
  tripId: string,
  outline: AdoptOutline,
): Promise<AdoptOutlineResult> {
  try {
    adoptTripOutline(tripId, outline);
    revalidatePath(`/trips/${tripId}`);
    return { ok: true };
  } catch (error) {
    return failure(error, "採用に失敗しました");
  }
}
