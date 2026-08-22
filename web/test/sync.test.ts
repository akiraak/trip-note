import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { POST as syncPost } from "@/app/api/sync/route";
import { GET as pullGet } from "@/app/api/sync/pull/route";

// /api/sync(push)と /api/sync/pull の LWW / tombstone をテスト毎に作る
// 一時 DB ファイルで検証する。getDb() は globalThis にキャッシュするため、
// テスト毎にキャッシュを破棄して TRIPNOTE_DB_PATH を差し替える

const SECRET = "test-secret";
const AUTH = { authorization: `Bearer ${SECRET}` };

let tempDir: string;

beforeEach(() => {
  process.env.API_SHARED_SECRET = SECRET;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-note-test-"));
  process.env.TRIPNOTE_DB_PATH = path.join(tempDir, "test.db");
});

afterEach(() => {
  const cache = globalThis as unknown as { __tripnoteDb?: Database.Database };
  cache.__tripnoteDb?.close();
  cache.__tripnoteDb = undefined;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function push(body: unknown, headers: Record<string, string> = AUTH) {
  return syncPost(
    new Request("http://test.local/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function pull(since?: string, headers: Record<string, string> = AUTH) {
  const url = new URL("http://test.local/api/sync/pull");
  if (since) url.searchParams.set("since", since);
  return pullGet(new Request(url, { headers }));
}

const trip = (over: Record<string, unknown> = {}) => ({
  id: "trip-1",
  title: "松本旅行",
  started_at: null,
  ended_at: null,
  transport: "car",
  deleted_at: null,
  updated_at: "2026-08-20T10:00:00.000Z",
  ...over,
});

const day = (over: Record<string, unknown> = {}) => ({
  id: "day-1",
  trip_id: "trip-1",
  date: "2026-09-01",
  title: "松本周辺を観光して泊",
  note: null,
  updated_at: "2026-08-20T10:00:00.000Z",
  deleted_at: null,
  ...over,
});

const checkpoint = (over: Record<string, unknown> = {}) => ({
  id: "cp-1",
  trip_id: "trip-1",
  trip_day_id: "day-1",
  type: "lodging",
  name: "浅間温泉の宿",
  latitude: 36.2571,
  longitude: 137.9841,
  planned_time: null,
  note: null,
  sort_order: 0,
  updated_at: "2026-08-20T10:00:00.000Z",
  deleted_at: null,
  ...over,
});

describe("POST /api/sync", () => {
  it("Bearer が無いと 401", async () => {
    const res = await push({ trips: [trip()] }, {});
    expect(res.status).toBe(401);
  });

  it("trips / days / checkpoints を upsert して pull で返す", async () => {
    const res = await push({
      trips: [trip()],
      days: [day()],
      checkpoints: [checkpoint()],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      trips: 1,
      days: 1,
      checkpoints: 1,
    });

    const pulled = await (await pull()).json();
    expect(pulled.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(pulled.trips).toHaveLength(1);
    expect(pulled.trips[0]).toMatchObject({
      id: "trip-1",
      title: "松本旅行",
      transport: "car",
      updated_at: "2026-08-20T10:00:00.000Z",
    });
    expect(pulled.days[0]).toMatchObject({ id: "day-1", date: "2026-09-01" });
    expect(pulled.checkpoints[0]).toMatchObject({
      id: "cp-1",
      type: "lodging",
      latitude: 36.2571,
    });
  });

  it("departure_at / destination を往復でき、省略時は null になる", async () => {
    await push({
      trips: [
        trip({
          departure_at: "2026-09-01T08:30:00.000Z",
          destination: "上高地",
        }),
      ],
    });
    let pulled = await (await pull()).json();
    expect(pulled.trips[0]).toMatchObject({
      departure_at: "2026-09-01T08:30:00.000Z",
      destination: "上高地",
    });

    // 旧クライアント互換: 省略して新しい updated_at で送ると null に戻る
    await push({
      trips: [trip({ updated_at: "2026-08-20T11:00:00.000Z" })],
    });
    pulled = await (await pull()).json();
    expect(pulled.trips[0].departure_at).toBeNull();
    expect(pulled.trips[0].destination).toBeNull();
  });

  it("trip_days.departure_time を往復でき、省略時は null になる", async () => {
    await push({
      trips: [trip()],
      days: [day({ departure_time: "08:30" })],
    });
    let pulled = await (await pull()).json();
    expect(pulled.days[0].departure_time).toBe("08:30");

    // 旧クライアント互換: 省略して新しい updated_at で送ると null に戻る
    await push({
      days: [day({ updated_at: "2026-08-20T11:00:00.000Z" })],
    });
    pulled = await (await pull()).json();
    expect(pulled.days[0].departure_time).toBeNull();
  });

  it("LWW: 新しい updated_at は勝ち、古い updated_at は無視される", async () => {
    await push({ trips: [trip()] });
    // 新しい編集は反映される
    await push({
      trips: [trip({ title: "新タイトル", updated_at: "2026-08-20T11:00:00.000Z" })],
    });
    let pulled = await (await pull()).json();
    expect(pulled.trips[0].title).toBe("新タイトル");

    // 古い編集は無視される(同時刻も既存を保持)
    await push({
      trips: [trip({ title: "古い編集", updated_at: "2026-08-20T09:00:00.000Z" })],
    });
    await push({
      trips: [trip({ title: "同時刻の編集", updated_at: "2026-08-20T11:00:00.000Z" })],
    });
    pulled = await (await pull()).json();
    expect(pulled.trips[0].title).toBe("新タイトル");
    expect(pulled.trips[0].updated_at).toBe("2026-08-20T11:00:00.000Z");
  });

  it("tombstone(deleted_at)が伝搬する", async () => {
    await push({ trips: [trip()], days: [day()] });
    await push({
      days: [
        day({
          deleted_at: "2026-08-20T12:00:00.000Z",
          updated_at: "2026-08-20T12:00:00.000Z",
        }),
      ],
    });
    const pulled = await (await pull()).json();
    expect(pulled.days).toHaveLength(1);
    expect(pulled.days[0].deleted_at).toBe("2026-08-20T12:00:00.000Z");
  });

  it("親の無い days / checkpoints はスキップして数を返す", async () => {
    await push({ trips: [trip()] });
    const res = await push({
      days: [day({ id: "day-x", trip_id: "unknown-trip" })],
      checkpoints: [checkpoint({ id: "cp-x", trip_day_id: "unknown-day" })],
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      days: 0,
      checkpoints: 0,
      skippedDays: 1,
      skippedCheckpoints: 1,
    });
  });

  it("不正な checkpoint type は 400", async () => {
    await push({ trips: [trip()], days: [day()] });
    const res = await push({ checkpoints: [checkpoint({ type: "spaceport" })] });
    expect(res.status).toBe(400);
  });

  it("updated_at を送らない旧クライアントの trips も受け付ける", async () => {
    const res = await push({
      trips: [trip({ updated_at: undefined })],
      points: [
        {
          id: "pt-1",
          trip_id: "trip-1",
          latitude: 36.2,
          longitude: 137.9,
          altitude: null,
          accuracy: 5,
          recorded_at: "2026-08-20T10:00:00.000Z",
        },
      ],
    });
    expect(res.status).toBe(200);
    const pulled = await (await pull()).json();
    // サーバ打刻の updated_at が入る
    expect(pulled.trips[0].updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

describe("GET /api/sync/pull", () => {
  it("Bearer が無いと 401", async () => {
    const res = await pull(undefined, {});
    expect(res.status).toBe(401);
  });

  it("since より新しい行だけを返す", async () => {
    await push({
      trips: [
        trip({ id: "old", updated_at: "2026-08-20T10:00:00.000Z" }),
        trip({ id: "new", updated_at: "2026-08-21T10:00:00.000Z" }),
      ],
    });
    const pulled = await (await pull("2026-08-20T12:00:00.000Z")).json();
    expect(pulled.trips.map((t: { id: string }) => t.id)).toEqual(["new"]);
  });

  it("since と同時刻の行は返さない(serverTime を次回 since に使うため)", async () => {
    await push({ trips: [trip({ updated_at: "2026-08-20T10:00:00.000Z" })] });
    const pulled = await (await pull("2026-08-20T10:00:00.000Z")).json();
    expect(pulled.trips).toHaveLength(0);
  });
});
