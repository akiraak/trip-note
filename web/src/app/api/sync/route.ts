import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { getDb } from "@/lib/db";

// iOS アプリからの同期エンドポイント。API_SHARED_SECRET の Bearer で保護する
// (本番の Cloudflare Access は /api/* を Bypass し、認証はこの Bearer のみ)

type SyncTrip = {
  id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
};

type SyncPoint = {
  id: string;
  trip_id: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  recorded_at: string;
};

function isTrip(value: unknown): value is SyncTrip {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.started_at === "string" &&
    (t.ended_at === null || t.ended_at === undefined || typeof t.ended_at === "string")
  );
}

function isPoint(value: unknown): value is SyncPoint {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.trip_id === "string" &&
    typeof p.latitude === "number" &&
    typeof p.longitude === "number" &&
    (p.altitude === null || p.altitude === undefined || typeof p.altitude === "number") &&
    (p.accuracy === null || p.accuracy === undefined || typeof p.accuracy === "number") &&
    typeof p.recorded_at === "string"
  );
}

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
  const { trips = [], points = [] } = (body ?? {}) as {
    trips?: unknown[];
    points?: unknown[];
  };
  if (
    !Array.isArray(trips) ||
    !Array.isArray(points) ||
    !trips.every(isTrip) ||
    !points.every(isPoint)
  ) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const db = getDb();
  const upsertTrip = db.prepare(`
    insert into trips (id, title, started_at, ended_at)
    values (@id, @title, @started_at, @ended_at)
    on conflict (id) do update set
      title = excluded.title,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);
  // 位置情報は不変なので既存 id は無視する
  const insertPoint = db.prepare(`
    insert or ignore into location_points
      (id, trip_id, latitude, longitude, altitude, accuracy, recorded_at)
    values
      (@id, @trip_id, @latitude, @longitude, @altitude, @accuracy, @recorded_at)
  `);
  const tripExists = db.prepare("select 1 from trips where id = ?");

  let skippedPoints = 0;
  db.transaction(() => {
    for (const trip of trips) {
      upsertTrip.run({ ...trip, ended_at: trip.ended_at ?? null });
    }
    for (const point of points) {
      // trip が存在しない点は FK 違反で全体を失敗させず、スキップして数を返す
      if (!tripExists.get(point.trip_id)) {
        skippedPoints++;
        continue;
      }
      insertPoint.run({
        ...point,
        altitude: point.altitude ?? null,
        accuracy: point.accuracy ?? null,
      });
    }
  })();

  return NextResponse.json({
    ok: true,
    trips: trips.length,
    points: points.length - skippedPoints,
    skippedPoints,
  });
}
