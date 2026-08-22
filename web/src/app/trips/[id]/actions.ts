"use server";

import { revalidatePath } from "next/cache";
import { searchPlaces, type Place } from "@/lib/nominatim";
import * as plan from "@/lib/plan";
import type { CheckpointInput } from "@/lib/plan";

// プラン編集の Server Actions。ページと同じ保護範囲(本番は Cloudflare Access)で
// 動くため Bearer 認証は使わない(/api/* の規約は変えない)。
// 実処理は lib/plan.ts(ユニットテスト対象)に置き、ここでは結果整形と再検証のみ行う

export type ActionResult = { ok: true } | { ok: false; error: string };

export type SearchResult =
  | { ok: true; places: Place[] }
  | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "操作に失敗しました",
  };
}

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`);
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

export async function searchPlacesAction(query: string): Promise<SearchResult> {
  try {
    return { ok: true, places: await searchPlaces(query) };
  } catch (error) {
    return failure(error);
  }
}
