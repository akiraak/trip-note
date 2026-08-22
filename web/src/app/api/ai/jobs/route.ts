import { NextResponse, after } from "next/server";
import { createAiJob, runAiJob } from "@/lib/ai-jobs";
import { authorized } from "@/lib/auth";

// AI 生成ジョブの登録(iOS 向け)。生成に数十秒〜数分かかるため、ここでは
// ジョブを作って即応答し、生成は応答送信後に after() で実行する。
// クライアントは GET /api/ai/jobs/[id] をポーリングして結果を受け取る。
// id はクライアント発行の UUID で、同 id の再送は既存ジョブの状態を返す(冪等)

export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const { id, kind, input } = body as Record<string, unknown>;
  let job;
  try {
    job = createAiJob({ id, kind, input });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不正な入力です";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (job.status === "pending") {
    after(() => runAiJob(job.id));
  }
  return NextResponse.json({ id: job.id, status: job.status }, { status: 202 });
}
