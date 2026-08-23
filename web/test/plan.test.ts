import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  addTripDay,
  adoptPlanSuggestion,
  createCheckpoint,
  deleteCheckpoint,
  deleteTrip,
  deleteTripDay,
  insertTripDayAfter,
  moveCheckpoint,
  nextDate,
  shiftIsoByDays,
  updateCheckpoint,
  updateTripDay,
  type CheckpointInput,
} from "@/lib/plan";
import type { Checkpoint, Trip, TripDay } from "@/lib/types";

// Web プラン編集(lib/plan.ts)の LWW 打刻 / tombstone / sort_order を
// テスト毎に作る一時 DB ファイルで検証する(sync.test.ts と同じ方式)

const OLD = "2026-08-01T00:00:00.000Z";

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
         (id, trip_id, trip_day_id, type, name, planned_time, sort_order,
          deleted_at, updated_at)
       values
         (@id, @trip_id, @trip_day_id, @type, @name, @planned_time, @sort_order,
          @deleted_at, @updated_at)`,
    )
    .run({
      id: "cp-1",
      trip_id: "trip-1",
      trip_day_id: "day-1",
      type: "sightseeing",
      name: "松本城",
      planned_time: null,
      sort_order: 0,
      deleted_at: null,
      updated_at: OLD,
      ...over,
    });
}

function getTripRow(id: string): Trip {
  return getDb().prepare("select * from trips where id = ?").get(id) as Trip;
}

function getDayRow(id: string): TripDay {
  return getDb().prepare("select * from trip_days where id = ?").get(id) as TripDay;
}

function getCheckpointRow(id: string): Checkpoint {
  return getDb()
    .prepare("select * from checkpoints where id = ?")
    .get(id) as Checkpoint;
}

const input = (over: Partial<CheckpointInput> = {}): CheckpointInput => ({
  type: "sightseeing",
  name: "松本城",
  latitude: null,
  longitude: null,
  planned_time: null,
  note: null,
  ...over,
});

describe("nextDate", () => {
  it("翌日を返す(月末・年末をまたぐ)", () => {
    expect(nextDate("2026-09-01")).toBe("2026-09-02");
    expect(nextDate("2026-09-30")).toBe("2026-10-01");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
  });

  it("YYYY-MM-DD 以外は拒否する", () => {
    expect(() => nextDate("2026/09/01")).toThrow();
  });
});

describe("addTripDay", () => {
  it("日が無ければ started_at の日付(表示 TZ)で 1 日目を作る", () => {
    // 2026-09-01T10:00Z は America/Los_Angeles では 09-01 03:00
    seedTrip({ started_at: "2026-09-01T10:00:00.000Z" });
    const day = addTripDay("trip-1");
    expect(day.date).toBe("2026-09-01");
    expect(day.trip_id).toBe("trip-1");
  });

  it("既存最終日の翌日を追加する(tombstone の日は無視)", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    seedDay({ id: "day-2", date: "2026-09-03", deleted_at: OLD });
    const day = addTripDay("trip-1");
    expect(day.date).toBe("2026-09-02");
  });

  it("削除済み・存在しない旅行には追加できない", () => {
    seedTrip({ deleted_at: OLD });
    expect(() => addTripDay("trip-1")).toThrow();
    expect(() => addTripDay("nope")).toThrow();
  });
});

describe("shiftIsoByDays", () => {
  it("表示 TZ の壁時計を保ったままずらす(DST の切り替わりを跨いでも)", () => {
    // 2026-10-31 09:00 PDT(-07:00) → 2026-11-01 09:00 PST(-08:00)
    expect(shiftIsoByDays("2026-10-31T16:00:00.000Z", 1)).toBe(
      "2026-11-01T17:00:00.000Z",
    );
    expect(shiftIsoByDays("2026-11-01T17:00:00.000Z", -1)).toBe(
      "2026-10-31T16:00:00.000Z",
    );
  });

  it("DST を跨がなければ 24 時間ずらす", () => {
    expect(shiftIsoByDays("2026-09-02T17:00:00.000Z", 1)).toBe(
      "2026-09-03T17:00:00.000Z",
    );
    expect(shiftIsoByDays("2026-09-02T17:00:00.000Z", -1)).toBe(
      "2026-09-01T17:00:00.000Z",
    );
  });

  it("不正な日時は拒否する", () => {
    expect(() => shiftIsoByDays("壊れた値", 1)).toThrow(/不正な日時/);
  });
});

describe("insertTripDayAfter", () => {
  it("翌日に日を差し込み、後続の日と planned_time を 1 日後ろへずらす", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    seedDay({ id: "day-2", date: "2026-09-02" });
    seedDay({ id: "day-3", date: "2026-09-03" });
    seedCheckpoint({
      id: "cp-2",
      trip_day_id: "day-2",
      planned_time: "2026-09-02T17:00:00.000Z",
    });
    const inserted = insertTripDayAfter("day-1");

    expect(inserted.date).toBe("2026-09-02");
    // 起点の日は動かさない(updated_at も進めない)
    expect(getDayRow("day-1").date).toBe("2026-09-01");
    expect(getDayRow("day-1").updated_at).toBe(OLD);
    expect(getDayRow("day-2").date).toBe("2026-09-03");
    expect(getDayRow("day-2").updated_at > OLD).toBe(true);
    expect(getDayRow("day-3").date).toBe("2026-09-04");
    const cp2 = getCheckpointRow("cp-2");
    expect(cp2.planned_time).toBe("2026-09-03T17:00:00.000Z");
    expect(cp2.updated_at > OLD).toBe(true);
  });

  it("最終日の後ではずらす対象が無く末尾に 1 日増える", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    seedDay({ id: "day-2", date: "2026-09-02" });
    const inserted = insertTripDayAfter("day-2");
    expect(inserted.date).toBe("2026-09-03");
    expect(getDayRow("day-1").updated_at).toBe(OLD);
    expect(getDayRow("day-2").updated_at).toBe(OLD);
  });

  it("削除済みの日・チェックポイントはずらさない", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    seedDay({ id: "day-2", date: "2026-09-02", deleted_at: OLD });
    seedDay({ id: "day-3", date: "2026-09-03" });
    seedCheckpoint({
      id: "cp-3",
      trip_day_id: "day-3",
      planned_time: "2026-09-03T17:00:00.000Z",
      deleted_at: OLD,
    });
    insertTripDayAfter("day-1");
    expect(getDayRow("day-2").date).toBe("2026-09-02");
    expect(getDayRow("day-2").updated_at).toBe(OLD);
    expect(getDayRow("day-3").date).toBe("2026-09-04");
    const cp3 = getCheckpointRow("cp-3");
    expect(cp3.planned_time).toBe("2026-09-03T17:00:00.000Z");
    expect(cp3.updated_at).toBe(OLD);
  });

  it("planned_time の無いチェックポイントの updated_at は進めない", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    seedDay({ id: "day-2", date: "2026-09-02" });
    seedCheckpoint({ id: "cp-2", trip_day_id: "day-2" });
    insertTripDayAfter("day-1");
    expect(getCheckpointRow("cp-2").updated_at).toBe(OLD);
  });

  it("削除済み・存在しない日は拒否する", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01", deleted_at: OLD });
    expect(() => insertTripDayAfter("day-1")).toThrow(/見つかりません/);
    expect(() => insertTripDayAfter("nope")).toThrow(/見つかりません/);
  });
});

describe("updateTripDay", () => {
  it("タイトル・メモを更新し updated_at を進める", () => {
    seedTrip();
    seedDay();
    updateTripDay("day-1", { title: " 松本周辺 ", note: null });
    const row = getDayRow("day-1");
    expect(row.title).toBe("松本周辺");
    expect(row.note).toBeNull();
    expect(row.updated_at > OLD).toBe(true);
  });

  it("departure_time を設定・クリアでき、省略時は保持する", () => {
    seedTrip();
    seedDay();
    updateTripDay("day-1", { title: null, note: null, departure_time: "08:30" });
    expect(getDayRow("day-1").departure_time).toBe("08:30");
    // 省略(undefined)は iOS からの同期値を保持する
    updateTripDay("day-1", { title: "松本周辺", note: null });
    expect(getDayRow("day-1").departure_time).toBe("08:30");
    updateTripDay("day-1", { title: null, note: null, departure_time: null });
    expect(getDayRow("day-1").departure_time).toBeNull();
  });

  it("HH:MM 以外の departure_time は拒否する", () => {
    seedTrip();
    seedDay();
    expect(() =>
      updateTripDay("day-1", { title: null, note: null, departure_time: "25:00" }),
    ).toThrow(/HH:MM/);
    expect(() =>
      updateTripDay("day-1", { title: null, note: null, departure_time: "8:30" }),
    ).toThrow(/HH:MM/);
  });
});

describe("deleteTrip", () => {
  it("旅行と生きている日・チェックポイントを tombstone にする", () => {
    seedTrip();
    seedDay();
    seedDay({ id: "day-2", date: "2026-09-02", deleted_at: OLD });
    seedCheckpoint({ id: "cp-1" });
    seedCheckpoint({ id: "cp-2", sort_order: 1, deleted_at: OLD });
    deleteTrip("trip-1");
    const trip = getTripRow("trip-1");
    expect(trip.deleted_at).not.toBeNull();
    expect(trip.updated_at > OLD).toBe(true);
    expect(getDayRow("day-1").deleted_at).not.toBeNull();
    expect(getCheckpointRow("cp-1").deleted_at).not.toBeNull();
    // 削除済みの行は触らない(updated_at を進めて LWW を乱さない)
    expect(getDayRow("day-2").updated_at).toBe(OLD);
    expect(getCheckpointRow("cp-2").updated_at).toBe(OLD);
  });

  it("削除済み・存在しない旅行は拒否する", () => {
    seedTrip({ deleted_at: OLD });
    expect(() => deleteTrip("trip-1")).toThrow(/見つかりません/);
    expect(() => deleteTrip("unknown")).toThrow(/見つかりません/);
  });
});

describe("deleteTripDay", () => {
  it("日と生きているチェックポイントを tombstone にする", () => {
    seedTrip();
    seedDay();
    seedCheckpoint({ id: "cp-1" });
    seedCheckpoint({ id: "cp-2", sort_order: 1, deleted_at: OLD });
    deleteTripDay("day-1");
    const day = getDayRow("day-1");
    expect(day.deleted_at).not.toBeNull();
    expect(day.updated_at > OLD).toBe(true);
    const cp1 = getCheckpointRow("cp-1");
    expect(cp1.deleted_at).not.toBeNull();
    expect(cp1.updated_at > OLD).toBe(true);
    // 削除済みの行は触らない(updated_at を進めて LWW を乱さない)
    const cp2 = getCheckpointRow("cp-2");
    expect(cp2.deleted_at).toBe(OLD);
    expect(cp2.updated_at).toBe(OLD);
  });

  it("後続の日と planned_time を 1 日前へ詰める", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    seedDay({ id: "day-2", date: "2026-09-02" });
    seedDay({ id: "day-3", date: "2026-09-03" });
    seedCheckpoint({
      id: "cp-3",
      trip_day_id: "day-3",
      planned_time: "2026-09-03T17:00:00.000Z",
    });
    deleteTripDay("day-2");

    expect(getDayRow("day-1").date).toBe("2026-09-01");
    expect(getDayRow("day-1").updated_at).toBe(OLD);
    // 消した日自身は日付を動かさない(tombstone なので表示されない)
    expect(getDayRow("day-2").date).toBe("2026-09-02");
    expect(getDayRow("day-3").date).toBe("2026-09-02");
    expect(getCheckpointRow("cp-3").planned_time).toBe(
      "2026-09-02T17:00:00.000Z",
    );
  });

  it("最終日の削除ではずらさない", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    seedDay({ id: "day-2", date: "2026-09-02" });
    deleteTripDay("day-2");
    expect(getDayRow("day-1").date).toBe("2026-09-01");
    expect(getDayRow("day-1").updated_at).toBe(OLD);
  });

  it("1 日目を削除しても残った先頭の日付は元の 1 日目のまま", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    seedDay({ id: "day-2", date: "2026-09-02" });
    seedDay({ id: "day-3", date: "2026-09-03" });
    deleteTripDay("day-1");
    expect(getDayRow("day-2").date).toBe("2026-09-01");
    expect(getDayRow("day-3").date).toBe("2026-09-02");
  });
});

describe("createCheckpoint", () => {
  it("生きている行の末尾の sort_order を割り当てる", () => {
    seedTrip();
    seedDay();
    seedCheckpoint({ id: "cp-1", sort_order: 0 });
    seedCheckpoint({ id: "cp-9", sort_order: 9, deleted_at: OLD });
    const created = createCheckpoint("day-1", input({ name: "旧開智学校" }));
    expect(created.sort_order).toBe(1);
    expect(created.trip_id).toBe("trip-1");
  });

  it("入力を検証・正規化する", () => {
    seedTrip();
    seedDay();
    expect(() => createCheckpoint("day-1", input({ name: "  " }))).toThrow();
    expect(() =>
      createCheckpoint("day-1", input({ latitude: 36.2 })),
    ).toThrow();
    expect(() =>
      createCheckpoint("day-1", input({ latitude: 120, longitude: 30 })),
    ).toThrow();
    expect(() =>
      createCheckpoint(
        "day-1",
        input({ type: "bogus" as CheckpointInput["type"] }),
      ),
    ).toThrow();
    const created = createCheckpoint(
      "day-1",
      input({ name: " 松本城 ", planned_time: "", note: "  " }),
    );
    expect(created.name).toBe("松本城");
    expect(created.planned_time).toBeNull();
    expect(created.note).toBeNull();
  });

  it("削除済みの日には追加できない", () => {
    seedTrip();
    seedDay({ deleted_at: OLD });
    expect(() => createCheckpoint("day-1", input())).toThrow();
  });
});

describe("updateCheckpoint / deleteCheckpoint", () => {
  it("更新はフィールドと updated_at を書き換える", () => {
    seedTrip();
    seedDay();
    seedCheckpoint();
    updateCheckpoint(
      "cp-1",
      input({ type: "lodging", name: "浅間温泉の宿", latitude: 36.25, longitude: 137.98 }),
    );
    const row = getCheckpointRow("cp-1");
    expect(row.type).toBe("lodging");
    expect(row.latitude).toBe(36.25);
    expect(row.updated_at > OLD).toBe(true);
  });

  it("削除は tombstone(物理削除しない)", () => {
    seedTrip();
    seedDay();
    seedCheckpoint();
    deleteCheckpoint("cp-1");
    const row = getCheckpointRow("cp-1");
    expect(row.deleted_at).not.toBeNull();
    expect(() => updateCheckpoint("cp-1", input())).toThrow();
  });
});

describe("moveCheckpoint", () => {
  it("隣と入れ替え、位置が変わった行だけ updated_at を進める", () => {
    seedTrip();
    seedDay();
    seedCheckpoint({ id: "cp-1", sort_order: 0 });
    seedCheckpoint({ id: "cp-2", sort_order: 1 });
    seedCheckpoint({ id: "cp-3", sort_order: 2 });
    moveCheckpoint("cp-3", -1);
    expect(getCheckpointRow("cp-1").sort_order).toBe(0);
    expect(getCheckpointRow("cp-3").sort_order).toBe(1);
    expect(getCheckpointRow("cp-2").sort_order).toBe(2);
    expect(getCheckpointRow("cp-1").updated_at).toBe(OLD);
    expect(getCheckpointRow("cp-2").updated_at > OLD).toBe(true);
    expect(getCheckpointRow("cp-3").updated_at > OLD).toBe(true);
  });

  it("端では何もしない", () => {
    seedTrip();
    seedDay();
    seedCheckpoint({ id: "cp-1", sort_order: 0 });
    seedCheckpoint({ id: "cp-2", sort_order: 1 });
    moveCheckpoint("cp-1", -1);
    moveCheckpoint("cp-2", 1);
    expect(getCheckpointRow("cp-1").sort_order).toBe(0);
    expect(getCheckpointRow("cp-2").sort_order).toBe(1);
    expect(getCheckpointRow("cp-1").updated_at).toBe(OLD);
    expect(getCheckpointRow("cp-2").updated_at).toBe(OLD);
  });

  it("削除済みの行は並びに含めない", () => {
    seedTrip();
    seedDay();
    seedCheckpoint({ id: "cp-1", sort_order: 0 });
    seedCheckpoint({ id: "cp-x", sort_order: 1, deleted_at: OLD });
    seedCheckpoint({ id: "cp-2", sort_order: 2 });
    moveCheckpoint("cp-2", -1);
    expect(getCheckpointRow("cp-2").sort_order).toBe(0);
    expect(getCheckpointRow("cp-1").sort_order).toBe(1);
    expect(getCheckpointRow("cp-x").sort_order).toBe(1); // 触らない
    expect(getCheckpointRow("cp-x").updated_at).toBe(OLD);
  });
});

describe("adoptPlanSuggestion", () => {
  const suggestedDays = [
    {
      date: "2026-09-01",
      title: "松本周辺を観光して泊",
      checkpoints: [
        { type: "departure" as const, name: "東京駅", note: null },
        { type: "sightseeing" as const, name: "松本城", note: "国宝" },
      ],
    },
    {
      date: "2026-09-02",
      title: "帰路",
      checkpoints: [{ type: "destination" as const, name: "自宅", note: null }],
    },
  ];

  it("日が無ければ日を作り、チェックポイントを座標未定で入れる", () => {
    seedTrip();
    adoptPlanSuggestion("trip-1", suggestedDays);
    const days = getDb()
      .prepare(
        "select * from trip_days where trip_id = 'trip-1' order by date",
      )
      .all() as TripDay[];
    expect(days.map((d) => [d.date, d.title])).toEqual([
      ["2026-09-01", "松本周辺を観光して泊"],
      ["2026-09-02", "帰路"],
    ]);
    const checkpoints = getDb()
      .prepare(
        `select * from checkpoints where trip_day_id = ?
         order by sort_order`,
      )
      .all(days[0].id) as Checkpoint[];
    expect(checkpoints.map((c) => [c.type, c.name, c.sort_order])).toEqual([
      ["departure", "東京駅", 0],
      ["sightseeing", "松本城", 1],
    ]);
    expect(checkpoints[0].latitude).toBeNull();
    expect(checkpoints[1].note).toBe("国宝");
  });

  it("概算座標があれば保存し、片方だけなら両方 null にする", () => {
    seedTrip();
    adoptPlanSuggestion("trip-1", [
      {
        date: "2026-09-01",
        title: null,
        checkpoints: [
          {
            type: "sightseeing" as const,
            name: "松本城",
            note: null,
            latitude: 36.2381,
            longitude: 137.969,
          },
          {
            type: "lodging" as const,
            name: "浅間温泉の宿",
            note: null,
            latitude: 36.26,
            longitude: null,
          },
        ],
      },
    ]);
    const checkpoints = getDb()
      .prepare("select * from checkpoints order by sort_order")
      .all() as Checkpoint[];
    expect(checkpoints[0].latitude).toBe(36.2381);
    expect(checkpoints[0].longitude).toBe(137.969);
    expect(checkpoints[1].latitude).toBeNull();
    expect(checkpoints[1].longitude).toBeNull();
  });

  it("同じ日付の日が既にあれば title を保ちつつ末尾に追記する", () => {
    seedTrip();
    seedDay({ id: "day-1", date: "2026-09-01" });
    getDb()
      .prepare("update trip_days set title = '既存タイトル' where id = 'day-1'")
      .run();
    seedCheckpoint({ id: "cp-1", sort_order: 0 });
    adoptPlanSuggestion("trip-1", [suggestedDays[0]]);
    const day = getDayRow("day-1");
    expect(day.title).toBe("既存タイトル");
    expect(day.updated_at).toBe(OLD); // 既存日は触らない
    const checkpoints = getDb()
      .prepare(
        "select * from checkpoints where trip_day_id = 'day-1' order by sort_order",
      )
      .all() as Checkpoint[];
    expect(checkpoints.map((c) => c.name)).toEqual([
      "松本城",
      "東京駅",
      "松本城",
    ]);
    expect(checkpoints.map((c) => c.sort_order)).toEqual([0, 1, 2]);
    // 日は増えていない
    const dayCount = getDb()
      .prepare(
        "select count(*) as n from trip_days where trip_id = 'trip-1'",
      )
      .get() as { n: number };
    expect(dayCount.n).toBe(1);
  });

  it("不正な日付・空の採用は拒否する", () => {
    seedTrip();
    expect(() => adoptPlanSuggestion("trip-1", [])).toThrow(/採用する日/);
    expect(() =>
      adoptPlanSuggestion("trip-1", [
        { ...suggestedDays[0], date: "9月1日" },
      ]),
    ).toThrow(/不正な日付/);
    expect(() => adoptPlanSuggestion("missing", suggestedDays)).toThrow(
      /旅行が見つかりません/,
    );
  });
});
