"use server";

import { revalidatePath } from "next/cache";
import { setAiModel } from "@/lib/ai";

// 設定ページの Server Actions。ページと同じ保護範囲(本番は Cloudflare Access)。
// 選択値はサーバの app_settings に保存し、iOS からの /api/ai/* にも自動で適用される

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setAiModelAction(id: string): Promise<ActionResult> {
  try {
    setAiModel(id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "保存に失敗しました",
    };
  }
}
