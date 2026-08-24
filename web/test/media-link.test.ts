import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { POST as syncPost } from "@/app/api/sync/route";
import { getDb } from "@/lib/db";
import {
  OUTSIDE_TOLERANCE_MS,
  nearestPointIndex,
  relinkTripMedia,
} from "@/lib/media-link";

// 紐付け直し(GPS 記録より先に取り込んだ写真の救済)。判定ルールは iOS の
// MediaAttachment と同じなので、iOS 側の MediaAttachmentTests と対になっている

describe("nearestPointIndex", () => {
  const times = [0, 100, 200];

  it("撮影時刻に最も近い点を選ぶ(同差なら先)", () => {
    expect(nearestPointIndex(times, 130)).toBe(1);
    expect(nearestPointIndex(times, 199)).toBe(2);
    expect(nearestPointIndex([0, 100], 50)).toBe(0);
  });

  it("点が無ければ null", () => {
    expect(nearestPointIndex([], 100)).toBeNull();
  });

  it("記録範囲の内側なら時間差が開いていても紐付ける", () => {
    // 静止中は点が増えないため、範囲の内側は時間差で弾かない
    const wide = [0, 10 * 60 * 60 * 1000];
    expect(nearestPointIndex(wide, 60 * 60 * 1000)).toBe(0);
  });

  it("記録範囲の外は許容時間差まで", () => {
    const recorded = [10_000, 20_000];
    expect(nearestPointIndex(recorded, 10_000 - OUTSIDE_TOLERANCE_MS)).toBe(0);
    expect(nearestPointIndex(recorded, 20_000 + OUTSIDE_TOLERANCE_MS)).toBe(1);
    expect(nearestPointIndex(recorded, 10_000 - OUTSIDE_TOLERANCE_MS - 1)).toBeNull();
    expect(nearestPointIndex(recorded, 20_000 + OUTSIDE_TOLERANCE_MS + 1)).toBeNull();
  });
});

describe("relinkTripMedia", () => {
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

  const trip = {
    id: "trip-1",
    title: "記録テスト",
    started_at: "2026-08-24T05:00:00.000Z",
    ended_at: null,
    deleted_at: null,
    updated_at: "2026-08-24T05:00:00.000Z",
  };

  function push(body: unknown) {
    return syncPost(
      new Request("http://test.local/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify(body),
      }),
    );
  }

  function insertTrip(db: Database.Database) {
    db.prepare(
      "insert into trips (id, title, started_at, updated_at) values (?, ?, ?, ?)",
    ).run(trip.id, trip.title, trip.started_at, trip.updated_at);
  }

  function insertMedia(
    db: Database.Database,
    id: string,
    takenAt: string,
    overrides: { locationPointId?: string; deletedAt?: string } = {},
  ) {
    db.prepare(
      `insert into media
         (id, trip_id, location_point_id, type, storage_path, taken_at, deleted_at)
       values (?, ?, ?, 'photo', ?, ?, ?)`,
    ).run(
      id,
      trip.id,
      overrides.locationPointId ?? null,
      `${id}.jpg`,
      takenAt,
      overrides.deletedAt ?? null,
    );
  }

  function insertPoint(db: Database.Database, id: string, recordedAt: string) {
    db.prepare(
      `insert into location_points (id, trip_id, latitude, longitude, recorded_at)
       values (?, ?, 47.6, -122.3, ?)`,
    ).run(id, trip.id, recordedAt);
  }

  function linkedPointId(db: Database.Database, id: string): string | null {
    return (
      db.prepare("select location_point_id from media where id = ?").get(id) as {
        location_point_id: string | null;
      }
    ).location_point_id;
  }

  it("点が後から入ったメディアを紐付ける", () => {
    const db = getDb();
    insertTrip(db);
    insertMedia(db, "media-1", "2026-08-24T06:10:00.000Z");
    insertPoint(db, "point-1", "2026-08-24T06:00:00.000Z");
    insertPoint(db, "point-2", "2026-08-24T06:12:00.000Z");

    expect(relinkTripMedia(db, trip.id)).toBe(1);
    expect(linkedPointId(db, "media-1")).toBe("point-2");
  });

  it("記録範囲から離れすぎたメディアは紐付けない", () => {
    const db = getDb();
    insertTrip(db);
    insertMedia(db, "media-1", "2026-08-24T12:00:00.000Z");
    insertPoint(db, "point-1", "2026-08-24T06:00:00.000Z");

    expect(relinkTripMedia(db, trip.id)).toBe(0);
    expect(linkedPointId(db, "media-1")).toBeNull();
  });

  it("紐付け済み・削除済みのメディアは触らない", () => {
    const db = getDb();
    insertTrip(db);
    insertPoint(db, "point-1", "2026-08-24T06:00:00.000Z");
    insertPoint(db, "point-2", "2026-08-24T06:10:00.000Z");
    insertMedia(db, "media-linked", "2026-08-24T06:10:00.000Z", {
      locationPointId: "point-1",
    });
    insertMedia(db, "media-deleted", "2026-08-24T06:10:00.000Z", {
      deletedAt: "2026-08-24T07:00:00.000Z",
    });

    expect(relinkTripMedia(db, trip.id)).toBe(0);
    expect(linkedPointId(db, "media-linked")).toBe("point-1");
    expect(linkedPointId(db, "media-deleted")).toBeNull();
  });

  it("/api/sync で点が届いたときに紐付け直して件数を返す", async () => {
    await push({ trips: [trip] });
    const db = getDb();
    insertMedia(db, "media-1", "2026-08-24T06:05:00.000Z");

    const res = await push({
      points: [
        {
          id: "point-1",
          trip_id: trip.id,
          latitude: 47.6,
          longitude: -122.3,
          altitude: null,
          accuracy: 5,
          recorded_at: "2026-08-24T06:04:00.000Z",
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ points: 1, relinkedMedia: 1 });
    expect(linkedPointId(db, "media-1")).toBe("point-1");
  });
});
