import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { relinkTripMedia } from "@/lib/media-link";
import { CHECKPOINT_TYPES } from "@/lib/types";

// iOS アプリからの同期エンドポイント。API_SHARED_SECRET の Bearer で保護する
// (本番の Cloudflare Access は /api/* を Bypass し、認証はこの Bearer のみ)
//
// プラン系(trips / days / checkpoints)は双方向同期: updated_at はクライアントの
// 編集時刻で、行単位の LWW(新しい方が勝つ)で upsert する。削除は tombstone
// (deleted_at)で伝搬する。points は従来通り不変・insert or ignore
//
// tombstone だけは LWW の外に置き、**削除は常に勝つ**ようにする(削除の取り消し
// 操作は iOS・Web とも無いので、これで表示可能な行が減ることはない):
//   1. 一度付いた deleted_at は解除しない(古い編集を新しい updated_at で
//      送られても、削除済みの行は削除済みのまま)
//   2. 受信行が tombstone なら、updated_at が古くても削除を反映する
//      (受け側の updated_at が進んでいると LWW で削除が永久に負けるため)
//   3. 親が削除済みなら子も削除済みにする(親の日が消えているのに
//      チェックポイントだけ生きている「孤児」を作らない)
// これを守らないと、削除と編集が別クライアントで前後したときに削除済みのはずの
// 行が生き返ったり、片方にだけ残ったりする
// (docs/plans/deleted-checkpoint-on-map.md)

/** 親行の tombstone 確認用(select deleted_at の結果) */
type Tombstone = { deleted_at: string | null };

type SyncTrip = {
  id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  transport?: string | null;
  departure_at?: string | null;
  destination?: string | null;
  deleted_at?: string | null;
  // 旧クライアント(Phase 3 以前)は送らないため省略可。省略時はサーバが打刻する
  updated_at?: string;
};

type SyncTripDay = {
  id: string;
  trip_id: string;
  date: string;
  title?: string | null;
  note?: string | null;
  /** 前泊地を出発する時刻 "HH:MM"。旧クライアントは送らないため省略可 = null */
  departure_time?: string | null;
  updated_at: string;
  deleted_at?: string | null;
};

type SyncCheckpoint = {
  id: string;
  trip_id: string;
  trip_day_id: string;
  type: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  planned_time?: string | null;
  note?: string | null;
  sort_order: number;
  updated_at: string;
  deleted_at?: string | null;
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

function isNullableString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}

function isNullableNumber(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "number";
}

function isTrip(value: unknown): value is SyncTrip {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    // started_at はプラン段階(未出発)では null
    isNullableString(t.started_at) &&
    isNullableString(t.ended_at) &&
    isNullableString(t.transport) &&
    isNullableString(t.departure_at) &&
    isNullableString(t.destination) &&
    isNullableString(t.deleted_at) &&
    isNullableString(t.updated_at)
  );
}

function isTripDay(value: unknown): value is SyncTripDay {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.trip_id === "string" &&
    typeof d.date === "string" &&
    isNullableString(d.title) &&
    isNullableString(d.note) &&
    isNullableString(d.departure_time) &&
    typeof d.updated_at === "string" &&
    isNullableString(d.deleted_at)
  );
}

function isCheckpoint(value: unknown): value is SyncCheckpoint {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.trip_id === "string" &&
    typeof c.trip_day_id === "string" &&
    typeof c.type === "string" &&
    (CHECKPOINT_TYPES as readonly string[]).includes(c.type) &&
    typeof c.name === "string" &&
    isNullableNumber(c.latitude) &&
    isNullableNumber(c.longitude) &&
    isNullableString(c.planned_time) &&
    isNullableString(c.note) &&
    typeof c.sort_order === "number" &&
    typeof c.updated_at === "string" &&
    isNullableString(c.deleted_at)
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
  const {
    trips = [],
    days = [],
    checkpoints = [],
    points = [],
  } = (body ?? {}) as {
    trips?: unknown[];
    days?: unknown[];
    checkpoints?: unknown[];
    points?: unknown[];
  };
  if (
    !Array.isArray(trips) ||
    !Array.isArray(days) ||
    !Array.isArray(checkpoints) ||
    !Array.isArray(points) ||
    !trips.every(isTrip) ||
    !days.every(isTripDay) ||
    !checkpoints.every(isCheckpoint) ||
    !points.every(isPoint)
  ) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const db = getDb();
  // LWW: excluded(受信行)の updated_at が新しいときだけ上書きする。
  // 同時刻は既存を保持(自分の push が pull で返ってきたときの無駄な更新を防ぐ)
  const upsertTrip = db.prepare(`
    insert into trips
      (id, title, started_at, ended_at, transport, departure_at, destination,
       deleted_at, updated_at)
    values
      (@id, @title, @started_at, @ended_at, @transport, @departure_at, @destination,
       @deleted_at, @updated_at)
    on conflict (id) do update set
      title = excluded.title,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      transport = excluded.transport,
      departure_at = excluded.departure_at,
      destination = excluded.destination,
      deleted_at = coalesce(trips.deleted_at, excluded.deleted_at),
      updated_at = excluded.updated_at
    where excluded.updated_at > trips.updated_at
  `);
  const upsertDay = db.prepare(`
    insert into trip_days
      (id, trip_id, date, title, note, departure_time, updated_at, deleted_at)
    values
      (@id, @trip_id, @date, @title, @note, @departure_time, @updated_at, @deleted_at)
    on conflict (id) do update set
      trip_id = excluded.trip_id,
      date = excluded.date,
      title = excluded.title,
      note = excluded.note,
      departure_time = excluded.departure_time,
      updated_at = excluded.updated_at,
      deleted_at = coalesce(trip_days.deleted_at, excluded.deleted_at)
    where excluded.updated_at > trip_days.updated_at
  `);
  const upsertCheckpoint = db.prepare(`
    insert into checkpoints
      (id, trip_id, trip_day_id, type, name, latitude, longitude,
       planned_time, note, sort_order, updated_at, deleted_at)
    values
      (@id, @trip_id, @trip_day_id, @type, @name, @latitude, @longitude,
       @planned_time, @note, @sort_order, @updated_at, @deleted_at)
    on conflict (id) do update set
      trip_id = excluded.trip_id,
      trip_day_id = excluded.trip_day_id,
      type = excluded.type,
      name = excluded.name,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      planned_time = excluded.planned_time,
      note = excluded.note,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at,
      deleted_at = coalesce(checkpoints.deleted_at, excluded.deleted_at)
    where excluded.updated_at > checkpoints.updated_at
  `);
  // 位置情報は不変なので既存 id は無視する
  const insertPoint = db.prepare(`
    insert or ignore into location_points
      (id, trip_id, latitude, longitude, altitude, accuracy, recorded_at)
    values
      (@id, @trip_id, @latitude, @longitude, @altitude, @accuracy, @recorded_at)
  `);
  // 親の存在確認と tombstone の確認を兼ねる(行が無ければ undefined)
  const parentTrip = db.prepare("select deleted_at from trips where id = ?");
  const parentDay = db.prepare("select deleted_at from trip_days where id = ?");
  const tripExists = db.prepare("select 1 from trips where id = ?");
  const serverNow = db.prepare(
    "select strftime('%Y-%m-%dT%H:%M:%fZ', 'now') as now",
  );
  // 受信行が tombstone なら、updated_at の新旧に関係なく削除を反映する。
  // updated_at はサーバ時刻にして、必ず次の pull で他クライアントへ配る
  const applyTombstone = (table: "trips" | "trip_days" | "checkpoints") =>
    db.prepare(
      `update ${table} set deleted_at = @deleted_at, updated_at = @now
       where id = @id and deleted_at is null`,
    );
  const tombstoneTrip = applyTombstone("trips");
  const tombstoneDay = applyTombstone("trip_days");
  const tombstoneCheckpoint = applyTombstone("checkpoints");
  // 親が削除済みになったら、まだ生きている子を道連れにする。
  // 子の tombstone が LWW で負けた・そもそも送られてこなかった場合の取りこぼし対策。
  // updated_at はサーバ時刻にして、必ず次の pull で配られるようにする
  const cascadeToDays = db.prepare(
    `update trip_days set deleted_at = @now, updated_at = @now
     where trip_id = @trip_id and deleted_at is null`,
  );
  const cascadeToCheckpointsOfTrip = db.prepare(
    `update checkpoints set deleted_at = @now, updated_at = @now
     where trip_id = @trip_id and deleted_at is null`,
  );
  const cascadeToCheckpointsOfDay = db.prepare(
    `update checkpoints set deleted_at = @now, updated_at = @now
     where trip_day_id = @day_id and deleted_at is null`,
  );

  let skippedDays = 0;
  let skippedCheckpoints = 0;
  let skippedPoints = 0;
  let relinkedMedia = 0;
  db.transaction(() => {
    const now = (serverNow.get() as { now: string }).now;
    for (const trip of trips) {
      upsertTrip.run({
        ...trip,
        started_at: trip.started_at ?? null,
        ended_at: trip.ended_at ?? null,
        transport: trip.transport ?? null,
        departure_at: trip.departure_at ?? null,
        destination: trip.destination ?? null,
        deleted_at: trip.deleted_at ?? null,
        // 旧クライアントは updated_at を送らないため、従来通りサーバが打刻する
        updated_at: trip.updated_at ?? now,
      });
      if (trip.deleted_at) {
        tombstoneTrip.run({ id: trip.id, deleted_at: trip.deleted_at, now });
      }
      if ((parentTrip.get(trip.id) as Tombstone | undefined)?.deleted_at) {
        cascadeToDays.run({ trip_id: trip.id, now });
        cascadeToCheckpointsOfTrip.run({ trip_id: trip.id, now });
      }
    }
    // 親が存在しない行は FK 違反で全体を失敗させず、スキップして数を返す
    // (同一ペイロード内の親は先に upsert 済み)。
    // 親が削除済みなら、受信行が生きていても親の deleted_at を継がせる(孤児を作らない)
    for (const day of days) {
      const parent = parentTrip.get(day.trip_id) as Tombstone | undefined;
      if (!parent) {
        skippedDays++;
        continue;
      }
      upsertDay.run({
        ...day,
        title: day.title ?? null,
        note: day.note ?? null,
        departure_time: day.departure_time ?? null,
        deleted_at: day.deleted_at ?? parent.deleted_at ?? null,
      });
      const dayDeletedAt = day.deleted_at ?? parent.deleted_at;
      if (dayDeletedAt) {
        tombstoneDay.run({ id: day.id, deleted_at: dayDeletedAt, now });
      }
      if ((parentDay.get(day.id) as Tombstone | undefined)?.deleted_at) {
        cascadeToCheckpointsOfDay.run({ day_id: day.id, now });
      }
    }
    for (const checkpoint of checkpoints) {
      const parent = parentDay.get(checkpoint.trip_day_id) as
        | Tombstone
        | undefined;
      if (!tripExists.get(checkpoint.trip_id) || !parent) {
        skippedCheckpoints++;
        continue;
      }
      upsertCheckpoint.run({
        ...checkpoint,
        latitude: checkpoint.latitude ?? null,
        longitude: checkpoint.longitude ?? null,
        planned_time: checkpoint.planned_time ?? null,
        note: checkpoint.note ?? null,
        deleted_at: checkpoint.deleted_at ?? parent.deleted_at ?? null,
      });
      const checkpointDeletedAt = checkpoint.deleted_at ?? parent.deleted_at;
      if (checkpointDeletedAt) {
        tombstoneCheckpoint.run({
          id: checkpoint.id,
          deleted_at: checkpointDeletedAt,
          now,
        });
      }
    }
    const pointTripIds = new Set<string>();
    for (const point of points) {
      if (!tripExists.get(point.trip_id)) {
        skippedPoints++;
        continue;
      }
      insertPoint.run({
        ...point,
        altitude: point.altitude ?? null,
        accuracy: point.accuracy ?? null,
      });
      pointTripIds.add(point.trip_id);
    }
    // 点が増えた旅行は、取り込み時に点が無くて位置が付かなかったメディアを紐付け直す
    // (media は不変・一方向アップロードなので iOS から送り直せない。詳細は lib/media-link.ts)
    for (const tripId of pointTripIds) {
      relinkedMedia += relinkTripMedia(db, tripId);
    }
  })();

  return NextResponse.json({
    ok: true,
    trips: trips.length,
    days: days.length - skippedDays,
    checkpoints: checkpoints.length - skippedCheckpoints,
    points: points.length - skippedPoints,
    skippedDays,
    skippedCheckpoints,
    skippedPoints,
    relinkedMedia,
  });
}
