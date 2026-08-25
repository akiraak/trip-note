"use server";

import { revalidatePath } from "next/cache";
import {
  parseLinkInput,
  resolveGoogleMapsLink,
  type ResolvedGoogleMapsPlace,
} from "@/lib/google-maps-share";
import { deleteMedia } from "@/lib/media";
import * as plan from "@/lib/plan";
import type { CheckpointInput } from "@/lib/plan";

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

/** 旅行のタイトル・出発予定・目的地を編集する(iOS の TripEditView 相当) */
export async function updateTripAction(
  tripId: string,
  input: plan.TripEditInput,
): Promise<ActionResult> {
  try {
    plan.updateTrip(tripId, input);
    revalidatePath("/");
    revalidateTrip(tripId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** 旅行を終了する(進行中のときだけ。一覧の表示も変わるので / も再検証する) */
export async function endTripAction(tripId: string): Promise<ActionResult> {
  try {
    plan.endTrip(tripId);
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

/** 指定した日の翌日に空の日を差し込む(以降の日は 1 日ずつ後ろへずれる) */
export async function insertDayAfterAction(
  dayId: string,
): Promise<ActionResult> {
  try {
    const day = plan.insertTripDayAfter(dayId);
    revalidateTrip(day.trip_id);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateDayAction(
  dayId: string,
  fields: {
    title: string | null;
    note: string | null;
    /** "HH:MM" / null で解除。省略すると現状維持(iOS からの同期値を保持) */
    departure_time?: string | null;
  },
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

/// 写真・動画の削除。ファイルは消え、行は tombstone として残って
/// 次の pull で iOS のローカルからも消える(docs/specs/phase4-media.md)
export async function deleteMediaAction(
  tripId: string,
  mediaId: string,
): Promise<ActionResult> {
  try {
    if (!deleteMedia(mediaId)) {
      return { ok: false, error: "このメディアは見つかりませんでした" };
    }
    revalidateTrip(tripId);
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
