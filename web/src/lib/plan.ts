import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { TIME_ZONE } from "./format";
import {
  CHECKPOINT_TYPES,
  type Checkpoint,
  type CheckpointType,
  type Trip,
  type TripDay,
} from "./types";

// プラン(trip_days / checkpoints)を Web から編集する純ロジック。
// Server Actions (app/trips/[id]/actions.ts) から呼ぶ。
// 双方向同期の LWW に合わせて、変更した行だけ updated_at を編集時刻にする。
// 削除は tombstone(deleted_at。物理削除しない)。iOS 側 Domain/PlanEditor.swift と対応

export type CheckpointInput = {
  type: CheckpointType;
  name: string;
  latitude: number | null;
  longitude: number | null;
  planned_time: string | null;
  note: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nowIso(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD の翌日を返す */
export function nextDate(dateString: string): string {
  if (!DATE_RE.test(dateString)) {
    throw new Error(`不正な日付です: ${dateString}`);
  }
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// 表示タイムゾーンでの YYYY-MM-DD (en-CA ロケールは YYYY-MM-DD 形式になる)
const dateStringFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dateStringOf(date: Date): string {
  return dateStringFormat.format(date);
}

function getTrip(tripId: string): Trip {
  const trip = getDb()
    .prepare("select * from trips where id = ? and deleted_at is null")
    .get(tripId) as Trip | undefined;
  if (!trip) throw new Error("旅行が見つかりません");
  return trip;
}

function getDay(dayId: string): TripDay {
  const day = getDb()
    .prepare("select * from trip_days where id = ? and deleted_at is null")
    .get(dayId) as TripDay | undefined;
  if (!day) throw new Error("日が見つかりません");
  return day;
}

function getCheckpoint(id: string): Checkpoint {
  const checkpoint = getDb()
    .prepare("select * from checkpoints where id = ? and deleted_at is null")
    .get(id) as Checkpoint | undefined;
  if (!checkpoint) throw new Error("チェックポイントが見つかりません");
  return checkpoint;
}

function validateInput(input: CheckpointInput): CheckpointInput {
  const name = input.name.trim();
  if (!name) throw new Error("名前を入力してください");
  if (!(CHECKPOINT_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`不正な種別です: ${input.type}`);
  }
  const { latitude, longitude } = input;
  if ((latitude === null) !== (longitude === null)) {
    throw new Error("緯度と経度は両方指定してください");
  }
  if (
    latitude !== null &&
    longitude !== null &&
    (Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
  ) {
    throw new Error("座標が範囲外です");
  }
  return {
    ...input,
    name,
    planned_time: input.planned_time || null,
    note: input.note?.trim() || null,
  };
}

/** 最終日の翌日を追加する。日が 1 つも無ければ started_at(未出発なら今日)の日付 */
export function addTripDay(tripId: string): TripDay {
  const trip = getTrip(tripId);
  const db = getDb();
  const last = db
    .prepare(
      "select max(date) as date from trip_days where trip_id = ? and deleted_at is null",
    )
    .get(tripId) as { date: string | null };
  const date = last.date
    ? nextDate(last.date)
    : dateStringOf(trip.started_at ? new Date(trip.started_at) : new Date());
  const id = randomUUID();
  db.prepare(
    `insert into trip_days (id, trip_id, date, updated_at)
     values (@id, @trip_id, @date, @updated_at)`,
  ).run({ id, trip_id: tripId, date, updated_at: nowIso() });
  return getDay(id);
}

export function updateTripDay(
  dayId: string,
  fields: { title: string | null; note: string | null },
): TripDay {
  const day = getDay(dayId);
  getDb()
    .prepare(
      "update trip_days set title = @title, note = @note, updated_at = @now where id = @id",
    )
    .run({
      id: dayId,
      title: fields.title?.trim() || null,
      note: fields.note?.trim() || null,
      now: nowIso(),
    });
  return day;
}

/** 日を削除する(tombstone)。ぶら下がるチェックポイントも道連れにする */
export function deleteTripDay(dayId: string): TripDay {
  const day = getDay(dayId);
  const db = getDb();
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `update checkpoints set deleted_at = @now, updated_at = @now
       where trip_day_id = @id and deleted_at is null`,
    ).run({ id: dayId, now });
    db.prepare(
      "update trip_days set deleted_at = @now, updated_at = @now where id = @id",
    ).run({ id: dayId, now });
  })();
  return day;
}

/** チェックポイントをその日の末尾に追加する */
export function createCheckpoint(
  dayId: string,
  input: CheckpointInput,
): Checkpoint {
  const day = getDay(dayId);
  const valid = validateInput(input);
  const db = getDb();
  const maxOrder = db
    .prepare(
      `select max(sort_order) as max_order from checkpoints
       where trip_day_id = ? and deleted_at is null`,
    )
    .get(dayId) as { max_order: number | null };
  const id = randomUUID();
  db.prepare(
    `insert into checkpoints
       (id, trip_id, trip_day_id, type, name, latitude, longitude,
        planned_time, note, sort_order, updated_at)
     values
       (@id, @trip_id, @trip_day_id, @type, @name, @latitude, @longitude,
        @planned_time, @note, @sort_order, @updated_at)`,
  ).run({
    id,
    trip_id: day.trip_id,
    trip_day_id: dayId,
    ...valid,
    sort_order: maxOrder.max_order !== null ? maxOrder.max_order + 1 : 0,
    updated_at: nowIso(),
  });
  return getCheckpoint(id);
}

export function updateCheckpoint(
  id: string,
  input: CheckpointInput,
): Checkpoint {
  const checkpoint = getCheckpoint(id);
  const valid = validateInput(input);
  getDb()
    .prepare(
      `update checkpoints set
         type = @type, name = @name, latitude = @latitude, longitude = @longitude,
         planned_time = @planned_time, note = @note, updated_at = @now
       where id = @id`,
    )
    .run({ id, ...valid, now: nowIso() });
  return checkpoint;
}

/** チェックポイントを削除する(tombstone) */
export function deleteCheckpoint(id: string): Checkpoint {
  const checkpoint = getCheckpoint(id);
  getDb()
    .prepare(
      "update checkpoints set deleted_at = @now, updated_at = @now where id = @id",
    )
    .run({ id, now: nowIso() });
  return checkpoint;
}

/** AI 行程提案の採用入力(lib/ai.ts の SuggestedDay に対応。座標は未定) */
export type AdoptDay = {
  /** YYYY-MM-DD */
  date: string;
  title: string | null;
  checkpoints: { type: CheckpointType; name: string; note: string | null }[];
};

/** AI 提案を採用して trip_days / checkpoints を作成する。
 *  同じ日付の日が既にあればそこへチェックポイントを末尾追記し(title は上書きしない)、
 *  無ければ日を作る。チェックポイントは座標未定(latitude/longitude null)で入れる */
export function adoptPlanSuggestion(tripId: string, days: AdoptDay[]): Trip {
  const trip = getTrip(tripId);
  if (days.length === 0) throw new Error("採用する日がありません");
  const db = getDb();
  const now = nowIso();
  const findDay = db.prepare(
    "select * from trip_days where trip_id = ? and date = ? and deleted_at is null",
  );
  const insertDay = db.prepare(
    `insert into trip_days (id, trip_id, date, title, updated_at)
     values (@id, @trip_id, @date, @title, @updated_at)`,
  );
  const maxOrder = db.prepare(
    `select max(sort_order) as max_order from checkpoints
     where trip_day_id = ? and deleted_at is null`,
  );
  const insertCheckpoint = db.prepare(
    `insert into checkpoints
       (id, trip_id, trip_day_id, type, name, latitude, longitude,
        planned_time, note, sort_order, updated_at)
     values
       (@id, @trip_id, @trip_day_id, @type, @name, null, null,
        null, @note, @sort_order, @updated_at)`,
  );
  db.transaction(() => {
    for (const day of days) {
      if (!DATE_RE.test(day.date)) {
        throw new Error(`不正な日付です: ${day.date}`);
      }
      let dayId = (findDay.get(tripId, day.date) as TripDay | undefined)?.id;
      if (!dayId) {
        dayId = randomUUID();
        insertDay.run({
          id: dayId,
          trip_id: tripId,
          date: day.date,
          title: day.title?.trim() || null,
          updated_at: now,
        });
      }
      const { max_order } = maxOrder.get(dayId) as { max_order: number | null };
      let order = max_order !== null ? max_order + 1 : 0;
      for (const checkpoint of day.checkpoints) {
        const valid = validateInput({
          type: checkpoint.type,
          name: checkpoint.name,
          latitude: null,
          longitude: null,
          planned_time: null,
          note: checkpoint.note,
        });
        insertCheckpoint.run({
          id: randomUUID(),
          trip_id: tripId,
          trip_day_id: dayId,
          type: valid.type,
          name: valid.name,
          note: valid.note,
          sort_order: order,
          updated_at: now,
        });
        order += 1;
      }
    }
  })();
  return trip;
}

/** 同じ日の中で 1 つ上/下と入れ替える。端では何もしない。
 *  位置が変わった行だけ sort_order と updated_at を更新する
 *  (変わらない行の updated_at を進めて LWW で他方の編集を潰さないため) */
export function moveCheckpoint(id: string, offset: -1 | 1): Checkpoint {
  const checkpoint = getCheckpoint(id);
  const db = getDb();
  const ordered = db
    .prepare(
      `select * from checkpoints
       where trip_day_id = ? and deleted_at is null
       order by sort_order, created_at`,
    )
    .all(checkpoint.trip_day_id) as Checkpoint[];
  const index = ordered.findIndex((c) => c.id === id);
  const target = index + offset;
  if (target < 0 || target >= ordered.length) {
    return checkpoint;
  }
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const now = nowIso();
  const update = db.prepare(
    "update checkpoints set sort_order = @sort_order, updated_at = @now where id = @id",
  );
  db.transaction(() => {
    ordered.forEach((c, i) => {
      if (c.sort_order !== i) {
        update.run({ id: c.id, sort_order: i, now });
      }
    });
  })();
  return checkpoint;
}
