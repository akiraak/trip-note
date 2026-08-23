"use server";

import { revalidatePath } from "next/cache";
import { parsePlanInput, suggestPlan, type PlanSuggestion } from "@/lib/ai";
import {
  parseLinkInput,
  resolveGoogleMapsLink,
  type ResolvedGoogleMapsPlace,
} from "@/lib/google-maps-share";
import * as plan from "@/lib/plan";
import type { AdoptDay, CheckpointInput } from "@/lib/plan";

// プラン編集の Server Actions。ページと同じ保護範囲(本番は Cloudflare Access)で
// 動くため Bearer 認証は使わない(/api/* の規約は変えない)。
// 実処理は lib/plan.ts(ユニットテスト対象)に置き、ここでは結果整形と再検証のみ行う

export type ActionResult = { ok: true } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "操作に失敗しました",
  };
}

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`);
}

export async function deleteTripAction(tripId: string): Promise<ActionResult> {
  try {
    plan.deleteTrip(tripId);
    revalidatePath("/");
    revalidateTrip(tripId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addDayAction(tripId: string): Promise<ActionResult> {
  try {
    const day = plan.addTripDay(tripId);
    revalidateTrip(day.trip_id);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateDayAction(
  dayId: string,
  fields: { title: string | null; note: string | null },
): Promise<ActionResult> {
  try {
    const day = plan.updateTripDay(dayId, fields);
    revalidateTrip(day.trip_id);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteDayAction(dayId: string): Promise<ActionResult> {
  try {
    const day = plan.deleteTripDay(dayId);
    revalidateTrip(day.trip_id);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addCheckpointAction(
  dayId: string,
  input: CheckpointInput,
): Promise<ActionResult> {
  try {
    const checkpoint = plan.createCheckpoint(dayId, input);
    revalidateTrip(checkpoint.trip_id);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateCheckpointAction(
  checkpointId: string,
  input: CheckpointInput,
): Promise<ActionResult> {
  try {
    const checkpoint = plan.updateCheckpoint(checkpointId, input);
    revalidateTrip(checkpoint.trip_id);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteCheckpointAction(
  checkpointId: string,
): Promise<ActionResult> {
  try {
    const checkpoint = plan.deleteCheckpoint(checkpointId);
    revalidateTrip(checkpoint.trip_id);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function moveCheckpointAction(
  checkpointId: string,
  offset: -1 | 1,
): Promise<ActionResult> {
  try {
    const checkpoint = plan.moveCheckpoint(checkpointId, offset);
    revalidateTrip(checkpoint.trip_id);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export type ResolveLinkResult =
  | { ok: true; place: ResolvedGoogleMapsPlace }
  | { ok: false; error: string };

/** Google Maps の共有リンク(短縮 URL / 場所ページの URL)から場所を取り出す */
export async function resolveGoogleMapsLinkAction(
  link: unknown,
): Promise<ResolveLinkResult> {
  try {
    return { ok: true, place: await resolveGoogleMapsLink(parseLinkInput(link)) };
  } catch (error) {
    return failure(error);
  }
}

// ---- AI 提案 ----
// AI 呼び出しの実処理は lib/ai.ts。入力は API route と同じ関数で再検証する

export type PlanSuggestResult =
  | { ok: true; suggestion: PlanSuggestion }
  | { ok: false; error: string };

export async function suggestPlanAction(
  input: unknown,
): Promise<PlanSuggestResult> {
  try {
    return { ok: true, suggestion: await suggestPlan(parsePlanInput(input)) };
  } catch (error) {
    return failure(error);
  }
}

/** AI 提案の採用。クライアントで確認済みの内容を trip_days / checkpoints にする */
export async function adoptPlanAction(
  tripId: string,
  days: AdoptDay[],
): Promise<ActionResult> {
  try {
    plan.adoptPlanSuggestion(tripId, days);
    revalidateTrip(tripId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
