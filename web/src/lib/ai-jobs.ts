import { getDb } from "@/lib/db";
import {
  parsePlanInput,
  parseTripOutlineInput,
  suggestPlan,
  suggestTripOutline,
} from "@/lib/ai";

// AI 生成の非同期ジョブ(/api/ai/jobs)。生成に数十秒〜数分かかるため、
// クライアントは接続を張りっぱなしにせず、ジョブ登録 → ポーリングで結果を受け取る。
// 提案は DB の trip_days / checkpoints には書かず、result 列に JSON で置くだけ
// (採用するかはクライアントが決める。従来の同期エンドポイントと同じ設計)

export type AiJobKind = "plan" | "trip_outline";
export type AiJobStatus = "pending" | "running" | "succeeded" | "failed";

export type AiJob = {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  input: unknown;
  result: unknown | null;
  error: string | null;
};

type AiJobRow = {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  input: string;
  result: string | null;
  error: string | null;
  updated_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 完了済みジョブを残す期間。ポーリングし損ねた結果の回収余地を残しつつ肥大化を防ぐ */
const RETENTION_DAYS = 7;

/** pending / running のままこの時間更新が無ければ、サーバ再起動などで
    実行が失われたとみなして failed に落とす(生成は長くても数分で終わる) */
const STALE_MINUTES = 10;

function toJob(row: AiJobRow): AiJob {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    input: JSON.parse(row.input),
    result: row.result === null ? null : JSON.parse(row.result),
    error: row.error,
  };
}

/** kind に応じた入力バリデーション(不正なら Error を投げる) */
function parseInput(kind: AiJobKind, input: unknown): unknown {
  return kind === "plan" ? parsePlanInput(input) : parseTripOutlineInput(input);
}

/** ジョブを登録する。id はクライアント発行の UUID で、同 id の再送は
    既存ジョブをそのまま返す(再送冪等。入力の差し替えはしない) */
export function createAiJob(value: {
  id: unknown;
  kind: unknown;
  input: unknown;
}): AiJob {
  const { id, kind } = value;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new Error("id は UUID で指定してください");
  }
  if (kind !== "plan" && kind !== "trip_outline") {
    throw new Error("kind は plan または trip_outline を指定してください");
  }
  const db = getDb();
  const existing = db.prepare("select * from ai_jobs where id = ?").get(id) as
    | AiJobRow
    | undefined;
  if (existing) {
    return toJob(existing);
  }
  const input = parseInput(kind, value.input);
  db.prepare(
    `delete from ai_jobs
     where created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${RETENTION_DAYS} days')`,
  ).run();
  db.prepare(
    "insert into ai_jobs (id, kind, status, input) values (?, ?, 'pending', ?)",
  ).run(id, kind, JSON.stringify(input));
  return getAiJob(id)!;
}

export function getAiJob(id: string): AiJob | null {
  const db = getDb();
  const row = db.prepare("select * from ai_jobs where id = ?").get(id) as
    | AiJobRow
    | undefined;
  if (!row) {
    return null;
  }
  // ISO8601(UTC・ミリ秒付き)同士なので文字列比較で新旧を判定できる
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  if (
    (row.status === "pending" || row.status === "running") &&
    row.updated_at < staleBefore
  ) {
    db.prepare(
      `update ai_jobs set status = 'failed',
         error = 'サーバ側で生成が中断されました。もう一度お試しください',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       where id = ? and status in ('pending', 'running')`,
    ).run(row.id);
    return getAiJob(id);
  }
  return toJob(row);
}

/** 既定の生成関数(テストではここを差し替える) */
async function generateSuggestion(
  kind: AiJobKind,
  input: unknown,
): Promise<unknown> {
  return kind === "plan"
    ? suggestPlan(input as Parameters<typeof suggestPlan>[0])
    : suggestTripOutline(input as Parameters<typeof suggestTripOutline>[0]);
}

/** pending のジョブを実行して結果を保存する。応答送信後に after() から呼ぶ。
    claim(pending → running)できなければ実行済み・実行中なので何もしない */
export async function runAiJob(
  id: string,
  generate: (kind: AiJobKind, input: unknown) => Promise<unknown> = generateSuggestion,
): Promise<void> {
  const db = getDb();
  const claimed = db
    .prepare(
      `update ai_jobs set status = 'running',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       where id = ? and status = 'pending'`,
    )
    .run(id);
  if (claimed.changes === 0) {
    return;
  }
  const row = db.prepare("select * from ai_jobs where id = ?").get(id) as AiJobRow;
  try {
    const result = await generate(row.kind, JSON.parse(row.input));
    db.prepare(
      `update ai_jobs set status = 'succeeded', result = ?, error = null,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       where id = ?`,
    ).run(JSON.stringify(result), id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI の呼び出しに失敗しました";
    db.prepare(
      `update ai_jobs set status = 'failed', error = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       where id = ?`,
    ).run(message, id);
  }
}
