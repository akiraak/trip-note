import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { POST as mediaPost } from "@/app/api/media/route";
import { getDb } from "@/lib/db";

// メディア自身の撮影位置(EXIF GPS / 動画メタデータ)を受け取る任意クエリの検証

const SECRET = "test-secret";
const TRIP_ID = "7f608fd1-12f9-4277-b12e-d43cb0d88603";
const MEDIA_ID = "0e94b872-0000-4000-8000-000000000001";

let tempDir: string;

beforeEach(() => {
  process.env.API_SHARED_SECRET = SECRET;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-note-test-"));
  process.env.TRIPNOTE_DB_PATH = path.join(tempDir, "test.db");
  getDb()
    .prepare("insert into trips (id, title, updated_at) values (?, '記録', ?)")
    .run(TRIP_ID, "2026-08-24T05:00:00.000Z");
});

afterEach(() => {
  const cache = globalThis as unknown as { __tripnoteDb?: Database.Database };
  cache.__tripnoteDb?.close();
  cache.__tripnoteDb = undefined;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function upload(extra: Record<string, string> = {}, id = MEDIA_ID) {
  const url = new URL("http://test.local/api/media");
  const query: Record<string, string> = {
    id,
    trip_id: TRIP_ID,
    type: "photo",
    taken_at: "2026-08-24T06:00:00.000Z",
    ext: "jpg",
    ...extra,
  };
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return mediaPost(
    new NextRequest(url, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: new Uint8Array([1, 2, 3]),
    }),
  );
}

function coordinateOf(id: string) {
  return getDb()
    .prepare("select latitude, longitude from media where id = ?")
    .get(id) as { latitude: number | null; longitude: number | null };
}

describe("POST /api/media", () => {
  it("座標を付けて送ると保存する", async () => {
    const res = await upload({ latitude: "47.6205", longitude: "-122.3493" });
    expect(res.status).toBe(200);
    expect(coordinateOf(MEDIA_ID)).toEqual({
      latitude: 47.6205,
      longitude: -122.3493,
    });
  });

  it("座標が無ければ null で保存する", async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    expect(coordinateOf(MEDIA_ID)).toEqual({ latitude: null, longitude: null });
  });

  it("片方だけの座標は 400", async () => {
    expect((await upload({ latitude: "47.6205" })).status).toBe(400);
    expect((await upload({ longitude: "-122.3493" })).status).toBe(400);
  });

  it("範囲外・数値でない座標は 400", async () => {
    expect((await upload({ latitude: "91", longitude: "0" })).status).toBe(400);
    expect((await upload({ latitude: "0", longitude: "181" })).status).toBe(400);
    expect((await upload({ latitude: "north", longitude: "0" })).status).toBe(400);
  });
});
