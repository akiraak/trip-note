"use server";

import { revalidatePath } from "next/cache";
import { createTrip, type TripInput } from "@/lib/plan";

// 旅行の作成。app/trips/[id]/actions.ts と同じくページと同じ保護範囲で動くため
// Bearer 認証は使わない(実処理は lib/plan.ts)

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
    return {
      ok: false,
      error: error instanceof Error ? error.message : "作成に失敗しました",
    };
  }
}
