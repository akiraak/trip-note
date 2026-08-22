import { NextResponse } from "next/server";
import { getAiJob } from "@/lib/ai-jobs";
import { authorized } from "@/lib/auth";

// AI 生成ジョブの状態取得(ポーリング用)。succeeded なら result に提案 JSON、
// failed なら error にメッセージが入る(pending / running では両方 null)

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/ai/jobs/[id]">,
) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const job = getAiJob(id);
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    result: job.result,
    error: job.error,
  });
}
