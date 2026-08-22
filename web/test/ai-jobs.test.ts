import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createAiJob, getAiJob, runAiJob } from "@/lib/ai-jobs";
import { getDb } from "@/lib/db";

// AI 生成の非同期ジョブ(lib/ai-jobs.ts)を検証する。実 LLM API は呼ばず、
// runAiJob の generate を差し替える(ai.test.ts と同方針)

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-note-test-"));
  process.env.TRIPNOTE_DB_PATH = path.join(tempDir, "test.db");
});

afterEach(() => {
  const cache = globalThis as unknown as { __tripnoteDb?: Database.Database };
  cache.__tripnoteDb?.close();
  cache.__tripnoteDb = undefined;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const JOB_ID = "0b7e4a52-1f0f-4c4c-9a3e-2f4f8f0d1234";

const PLAN_INPUT = {
  departure: "東京駅",
  destination: "自宅",
  startDate: "2026-09-01",
  dayCount: 3,
};

const OUTLINE_INPUT = {
  destination: "上高地",
  departureDate: "2026-09-01",
  departureTime: "08:00",
};

describe("createAiJob", () => {
  it("plan ジョブを pending で登録する", () => {
    const job = createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    expect(job.status).toBe("pending");
    expect(job.kind).toBe("plan");
    // 省略可の入力はバリデーションで null に正規化して保存する
    expect(job.input).toMatchObject({ ...PLAN_INPUT, transport: null });
  });

  it("trip_outline ジョブを登録できる", () => {
    const job = createAiJob({
      id: JOB_ID,
      kind: "trip_outline",
      input: OUTLINE_INPUT,
    });
    expect(job.status).toBe("pending");
    expect(job.kind).toBe("trip_outline");
  });

  it("同 id の再送は既存ジョブをそのまま返す(冪等)", () => {
    createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    getDb()
      .prepare("update ai_jobs set status = 'succeeded' where id = ?")
      .run(JOB_ID);
    const again = createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    expect(again.status).toBe("succeeded");
    expect(getDb().prepare("select count(*) as n from ai_jobs").get()).toEqual({
      n: 1,
    });
  });

  it("UUID でない id / 未知の kind / 不正な入力は拒否する", () => {
    expect(() =>
      createAiJob({ id: "abc", kind: "plan", input: PLAN_INPUT }),
    ).toThrow(/UUID/);
    expect(() =>
      createAiJob({ id: JOB_ID, kind: "search_assist", input: {} }),
    ).toThrow(/kind/);
    expect(() =>
      createAiJob({ id: JOB_ID, kind: "plan", input: { departure: " " } }),
    ).toThrow();
    // 失敗時は行を作らない
    expect(getAiJob(JOB_ID)).toBeNull();
  });

  it("登録時に 7 日より古いジョブを削除する", () => {
    createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    getDb()
      .prepare(
        `update ai_jobs set created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')
         where id = ?`,
      )
      .run(JOB_ID);
    createAiJob({
      id: "1c8f5b63-2a1a-4d5d-8b4f-3a5a9b1e5678",
      kind: "plan",
      input: PLAN_INPUT,
    });
    expect(getAiJob(JOB_ID)).toBeNull();
  });
});

describe("runAiJob", () => {
  it("成功したら succeeded + result を保存する", async () => {
    createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    await runAiJob(JOB_ID, async (kind, input) => {
      expect(kind).toBe("plan");
      expect(input).toMatchObject(PLAN_INPUT);
      return { days: [] };
    });
    const job = getAiJob(JOB_ID)!;
    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({ days: [] });
    expect(job.error).toBeNull();
  });

  it("失敗したら failed + error を保存する", async () => {
    createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    await runAiJob(JOB_ID, async () => {
      throw new Error("AI の呼び出しに失敗しました: boom");
    });
    const job = getAiJob(JOB_ID)!;
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/boom/);
    expect(job.result).toBeNull();
  });

  it("pending 以外は claim できず生成を実行しない(二重実行防止)", async () => {
    createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    await runAiJob(JOB_ID, async () => ({ days: [] }));
    let called = false;
    await runAiJob(JOB_ID, async () => {
      called = true;
      return { days: [{ overwritten: true }] };
    });
    expect(called).toBe(false);
    expect(getAiJob(JOB_ID)!.result).toEqual({ days: [] });
  });

  it("未知の id は何もしない", async () => {
    await expect(runAiJob(JOB_ID, async () => ({}))).resolves.toBeUndefined();
  });
});

describe("getAiJob", () => {
  it("未知の id は null", () => {
    expect(getAiJob(JOB_ID)).toBeNull();
  });

  it("更新が 10 分以上前の pending / running は failed に落とす", () => {
    createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    getDb()
      .prepare(
        `update ai_jobs set status = 'running',
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 minutes')
         where id = ?`,
      )
      .run(JOB_ID);
    const job = getAiJob(JOB_ID)!;
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/中断/);
  });

  it("直近の running はそのまま返す", () => {
    createAiJob({ id: JOB_ID, kind: "plan", input: PLAN_INPUT });
    getDb()
      .prepare("update ai_jobs set status = 'running' where id = ?")
      .run(JOB_ID);
    expect(getAiJob(JOB_ID)!.status).toBe("running");
  });
});
