import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { readTripPlan } from "@/lib/trip-plan";

// 旅行詳細のプラン読み出し(lib/trip-plan.ts)。日カード・地図のピン・破線ルートが
// 同じ集合になること、tombstone(日・チェックポイントの両方)が漏れないことを
// テスト毎に作る一時 DB ファイルで検証する(plan.test.ts と同じ方式)

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
      `insert into trips
         (id, title, started_at, ended_at, departure_at, destination, deleted_at, updated_at)
       values
         (@id, @title, @started_at, @ended_at, @departure_at, @destination, @deleted_at, @updated_at)`,
    )
    .run({
      id: "trip-1",
      title: "松本旅行",
      started_at: null,
      ended_at: null,
      departure_at: null,
      destination: null,
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
         (id, trip_id, trip_day_id, type, name, latitude, longitude,
          planned_time, sort_order, deleted_at, updated_at)
       values
         (@id, @trip_id, @trip_day_id, @type, @name, @latitude, @longitude,
          @planned_time, @sort_order, @deleted_at, @updated_at)`,
    )
    .run({
      id: "cp-1",
      trip_id: "trip-1",
      trip_day_id: "day-1",
      type: "sightseeing",
      name: "松本城",
      latitude: 36.238,
      longitude: 137.968,
      planned_time: null,
      sort_order: 0,
      deleted_at: null,
      updated_at: OLD,
      ...over,
    });
}

describe("readTripPlan", () => {
  it("日カード・地図のピン・ルートを同じ集合から返す", () => {
    seedDay();
    seedCheckpoint();
    seedCheckpoint({ id: "cp-2", name: "縄手通り", sort_order: 1 });

    const plan = readTripPlan("trip-1");

    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].checkpoints.map((c) => c.id)).toEqual(["cp-1", "cp-2"]);
    expect(plan.markers.map((m) => m.id)).toEqual(["cp-1", "cp-2"]);
    expect(plan.route).toHaveLength(2);
  });

  it("削除したチェックポイントは日カードにも地図にも出さない", () => {
    seedDay();
    seedCheckpoint();
    seedCheckpoint({ id: "cp-2", name: "消した店", deleted_at: OLD });

    const plan = readTripPlan("trip-1");

    expect(plan.days[0].checkpoints.map((c) => c.id)).toEqual(["cp-1"]);
    expect(plan.markers.map((m) => m.id)).toEqual(["cp-1"]);
    expect(plan.route).toHaveLength(1);
  });

  // 同期の LWW 競合で「日は削除済みなのにチェックポイントが生きている」行が
  // 生まれ得る。これを地図にだけ出すと「削除したのにピンが残る」ことになる
  // (docs/plans/deleted-checkpoint-on-map.md)
  it("親の日が削除済みのチェックポイント(孤児)は地図にもルートにも出さない", () => {
    seedDay();
    seedCheckpoint();
    seedDay({ id: "day-2", date: "2026-09-02", deleted_at: OLD });
    seedCheckpoint({
      id: "cp-orphan",
      trip_day_id: "day-2",
      name: "岐阜の宿",
      type: "lodging",
      latitude: 35.4233,
      longitude: 136.7606,
    });

    const plan = readTripPlan("trip-1");

    expect(plan.days.map((d) => d.id)).toEqual(["day-1"]);
    expect(plan.markers.map((m) => m.id)).toEqual(["cp-1"]);
    expect(plan.route).toEqual([{ latitude: 36.238, longitude: 137.968 }]);
  });

  it("座標の無いチェックポイントは日カードには出し、地図には出さない", () => {
    seedDay();
    seedCheckpoint({ id: "cp-noloc", name: "どこかの温泉", latitude: null, longitude: null });

    const plan = readTripPlan("trip-1");

    expect(plan.days[0].checkpoints.map((c) => c.id)).toEqual(["cp-noloc"]);
    expect(plan.markers).toEqual([]);
    expect(plan.route).toEqual([]);
  });

  it("ピンとルートは日付順 → 日内 sort_order 順に並ぶ", () => {
    // 日付の新しい方を先に入れ、sort_order も逆順にして並び替えを確かめる
    seedDay({ id: "day-2", date: "2026-09-02" });
    seedDay();
    seedCheckpoint({ id: "d2-c1", trip_day_id: "day-2", sort_order: 1, latitude: 3, longitude: 3 });
    seedCheckpoint({ id: "d2-c0", trip_day_id: "day-2", sort_order: 0, latitude: 2, longitude: 2 });
    seedCheckpoint({ id: "d1-c0", trip_day_id: "day-1", sort_order: 0, latitude: 1, longitude: 1 });

    const plan = readTripPlan("trip-1");

    expect(plan.markers.map((m) => m.id)).toEqual(["d1-c0", "d2-c0", "d2-c1"]);
    expect(plan.route.map((p) => p.latitude)).toEqual([1, 2, 3]);
  });

  it("別の旅行のチェックポイントは混ざらない", () => {
    seedDay();
    seedCheckpoint();
    seedTrip({ id: "trip-2", title: "別の旅行" });
    seedDay({ id: "day-other", trip_id: "trip-2", date: "2026-09-01" });
    seedCheckpoint({
      id: "cp-other",
      trip_id: "trip-2",
      trip_day_id: "day-other",
      name: "別の地点",
    });

    const plan = readTripPlan("trip-1");

    expect(plan.days.map((d) => d.id)).toEqual(["day-1"]);
    expect(plan.markers.map((m) => m.id)).toEqual(["cp-1"]);
  });
});
