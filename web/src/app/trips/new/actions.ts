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
import {
  adoptTripOutline,
  createTrip,
  type AdoptOutline,
  type TripInput,
} from "@/lib/plan";

// 旅行の作成と、作成直後の AI 日数・宿泊地候補ステップ。
// app/trips/[id]/actions.ts と同じくページと同じ保護範囲で動くため Bearer 認証は
// 使わない(実処理は lib/plan.ts / lib/ai-jobs.ts)

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

export type CreateTripResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createTripAction(
  input: TripInput,
): Promise<CreateTripResult> {
  try {
    const trip = createTrip(input);
    revalidatePath("/");
    return { ok: true, id: trip.id };
  } catch (error) {
    return failure(error, "作成に失敗しました");
  }
}

// ---- AI の日数・宿泊地候補 ----
// 生成は 1 分前後かかるので iOS と同じジョブ方式(ai_jobs)にする。
// ここでジョブを登録して即返し、生成は応答後の after() で実行、
// クライアントは pollTripOutlineAction でポーリングする

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
