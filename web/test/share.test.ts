import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  findSharedTrip,
  generateShareToken,
  issueShareToken,
  readSharedMedia,
  readSharedTrip,
  revokeShareToken,
  SHARE_TOKEN_RE,
} from "@/lib/share";

// 共有リンク(lib/share.ts)。発行・停止の冪等性と updated_at を動かさないこと、
// トークンで引ける範囲(削除済み・停止済み・他の旅行・tombstone を含まない)を
// テスト毎に作る一時 DB ファイルで検証する(trip-plan.test.ts と同じ方式)

const OLD = "2026-08-01T00:00:00.000Z";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-note-test-"));
  process.env.TRIPNOTE_DB_PATH = path.join(tempDir, "test.db");
  seedTrip();
});

afterEach(() => {
  const cache = globalThis as unknown as { __tripnoteDb?: Database.Database };
  cache.__tripnoteDb?.close();
  cache.__tripnoteDb = undefined;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedTrip(over: Record<string, unknown> = {}) {
  getDb()
    .prepare(
      `insert into trips (id, title, started_at, deleted_at, updated_at)
       values (@id, @title, @started_at, @deleted_at, @updated_at)`,
    )
    .run({
      id: "trip-1",
      title: "松本旅行",
      started_at: null,
      deleted_at: null,
      updated_at: OLD,
      ...over,
    });
}

function seedDay(over: Record<string, unknown> = {}) {
  getDb()
    .prepare(
      `insert into trip_days (id, trip_id, date, deleted_at, updated_at)
       values (@id, @trip_id, @date, @deleted_at, @updated_at)`,
    )
    .run({
      id: "day-1",
      trip_id: "trip-1",
      date: "2026-09-01",
      deleted_at: null,
      updated_at: OLD,
      ...over,
    });
}

function seedCheckpoint(over: Record<string, unknown> = {}) {
  getDb()
    .prepare(
      `insert into checkpoints
         (id, trip_id, trip_day_id, type, name, latitude, longitude, sort_order, deleted_at, updated_at)
       values
         (@id, @trip_id, @trip_day_id, @type, @name, @latitude, @longitude, @sort_order, @deleted_at, @updated_at)`,
    )
    .run({
      id: "cp-1",
      trip_id: "trip-1",
      trip_day_id: "day-1",
      type: "sightseeing",
      name: "松本城",
      latitude: 36.2384,
      longitude: 137.969,
      sort_order: 0,
      deleted_at: null,
      updated_at: OLD,
      ...over,
    });
}

function seedMedia(over: Record<string, unknown> = {}) {
  getDb()
    .prepare(
      `insert into media (id, trip_id, type, storage_path, taken_at, deleted_at)
       values (@id, @trip_id, @type, @storage_path, @taken_at, @deleted_at)`,
    )
    .run({
      id: "media-1",
      trip_id: "trip-1",
      type: "photo",
      storage_path: "media-1.jpg",
      taken_at: "2026-09-01T10:00:00.000Z",
      deleted_at: null,
      ...over,
    });
}

function tripRow(id = "trip-1") {
  return getDb()
    .prepare("select share_token, updated_at from trips where id = ?")
    .get(id) as { share_token: string | null; updated_at: string };
}

describe("generateShareToken", () => {
  it("URL に入る 24 文字の base64url で、毎回違う", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toHaveLength(24);
    expect(a).toMatch(SHARE_TOKEN_RE);
    expect(a).not.toBe(b);
  });
});

describe("issueShareToken / revokeShareToken", () => {
  it("発行は冪等で、updated_at を動かさない", () => {
    const first = issueShareToken("trip-1");
    expect(first).toMatch(SHARE_TOKEN_RE);
    expect(issueShareToken("trip-1")).toBe(first);
    expect(tripRow()).toEqual({ share_token: first, updated_at: OLD });
  });

  it("停止で null になり、発行し直すと別のトークンになる", () => {
    const first = issueShareToken("trip-1");
    revokeShareToken("trip-1");
    expect(tripRow()).toEqual({ share_token: null, updated_at: OLD });
    // 未発行の状態でもう一度止めても成功扱い
    revokeShareToken("trip-1");
    const second = issueShareToken("trip-1");
    expect(second).not.toBe(first);
  });

  it("無い・削除済みの旅行には発行できない", () => {
    expect(() => issueShareToken("nope")).toThrow("旅行が見つかりません");
    seedTrip({ id: "trip-gone", deleted_at: OLD });
    expect(() => issueShareToken("trip-gone")).toThrow("旅行が見つかりません");
    expect(() => revokeShareToken("trip-gone")).toThrow("旅行が見つかりません");
  });
});

describe("findSharedTrip / readSharedTrip", () => {
  it("形式外・不一致・停止済み・削除済みは null", () => {
    const token = issueShareToken("trip-1");
    expect(findSharedTrip("")).toBeNull();
    expect(findSharedTrip("short")).toBeNull();
    expect(findSharedTrip("../../etc/passwd-aaaaaaaaaaa")).toBeNull();
    expect(findSharedTrip(`${token.slice(0, -1)}!`)).toBeNull();
    expect(findSharedTrip(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(readSharedTrip("no-such-token-0000000000")).toBeNull();

    revokeShareToken("trip-1");
    expect(findSharedTrip(token)).toBeNull();
    expect(readSharedTrip(token)).toBeNull();

    const again = issueShareToken("trip-1");
    getDb().prepare("update trips set deleted_at = ? where id = 'trip-1'").run(OLD);
    expect(findSharedTrip(again)).toBeNull();
    expect(readSharedTrip(again)).toBeNull();
  });

  it("旅行の情報・記録点・メディア・プラン・キャッシュ済みレグを返し、tombstone は含めない", () => {
    getDb()
      .prepare(
        `insert into location_points (id, trip_id, latitude, longitude, recorded_at)
         values ('p1', 'trip-1', 36.0, 137.0, '2026-09-01T00:00:00.000Z'),
                ('p2', 'trip-1', 36.1, 137.1, '2026-09-01T00:10:00.000Z')`,
      )
      .run();
    seedDay();
    seedDay({ id: "day-gone", date: "2026-09-02", deleted_at: OLD });
    seedCheckpoint();
    seedCheckpoint({ id: "cp-gone", deleted_at: OLD, sort_order: 1 });
    seedCheckpoint({ id: "cp-orphan", trip_day_id: "day-gone", sort_order: 0 });
    seedMedia();
    seedMedia({ id: "media-old", taken_at: "2026-08-31T10:00:00.000Z" });
    seedMedia({ id: "media-gone", deleted_at: OLD });

    const token = issueShareToken("trip-1");
    const shared = readSharedTrip(token);
    expect(shared).not.toBeNull();
    expect(shared!.trip).toEqual({
      id: "trip-1",
      title: "松本旅行",
      started_at: null,
      ended_at: null,
      departure_at: null,
      destination: null,
    });
    // トークンや内部列は返さない
    expect(shared!.trip).not.toHaveProperty("share_token");
    expect(shared!.points.map((p) => p.recorded_at)).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T00:10:00.000Z",
    ]);
    // 撮影時刻の新しい順、tombstone 除外
    expect(shared!.media.map((m) => m.id)).toEqual(["media-1", "media-old"]);
    expect(shared!.media[0].marker).toBeNull();
    expect(shared!.plan.days.map((d) => d.id)).toEqual(["day-1"]);
    expect(shared!.plan.days[0].checkpoints.map((c) => c.id)).toEqual(["cp-1"]);
    expect(shared!.plan.markers.map((m) => m.id)).toEqual(["cp-1"]);
    expect(shared!.cachedLegs).toEqual({});
  });
});

describe("readSharedMedia", () => {
  it("そのトークンの旅行に属する削除済みでないメディアだけ返す", () => {
    seedTrip({ id: "trip-2", title: "別の旅行" });
    seedMedia();
    seedMedia({ id: "media-gone", deleted_at: OLD });
    seedMedia({ id: "media-other", trip_id: "trip-2" });
    const token = issueShareToken("trip-1");
    const other = issueShareToken("trip-2");

    expect(readSharedMedia(token, "media-1")?.storage_path).toBe("media-1.jpg");
    expect(readSharedMedia(token, "media-gone")).toBeNull();
    expect(readSharedMedia(token, "media-other")).toBeNull();
    expect(readSharedMedia(other, "media-1")).toBeNull();
    expect(readSharedMedia("bad token", "media-1")).toBeNull();

    revokeShareToken("trip-1");
    expect(readSharedMedia(token, "media-1")).toBeNull();
  });
});
