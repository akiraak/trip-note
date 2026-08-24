import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { TIME_ZONE } from "./format";
import { departureShiftDays } from "./plan-dates";
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
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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

// 表示タイムゾーンでの HH:mm
const timeStringFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

export function timeStringOf(date: Date): string {
  return timeStringFormat.format(date);
}

// 表示タイムゾーンでの日時の各要素(UTC オフセットの算出用)
const tzPartsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** その瞬間の表示タイムゾーンの UTC オフセット(ミリ秒) */
function tzOffsetMs(date: Date): number {
  const parts = Object.fromEntries(
    tzPartsFormat.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

/** ISO8601 の日時を offsetDays 日ずらす。
 *  単純な 24 時間加算だと DST を跨いだときに壁時計が 1 時間ずれるため、
 *  表示タイムゾーンのオフセット差分で打ち消す(9:00 発は動かした先でも 9:00 発) */
export function shiftIsoByDays(iso: string, offsetDays: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`不正な日時です: ${iso}`);
  }
  const naive = new Date(date.getTime() + offsetDays * 86_400_000);
  const corrected = new Date(
    naive.getTime() + (tzOffsetMs(date) - tzOffsetMs(naive)),
  );
  return corrected.toISOString();
}

/** 表示タイムゾーンの壁時計(YYYY-MM-DD + HH:mm)を ISO8601 の瞬間にする。
 *  ブラウザのローカル TZ で解釈すると入力した日付と 1 日目の日付がずれ得るため、
 *  作成フォームの出発日時はこちらで解釈する。オフセットは瞬間ごとに変わる(DST)ので
 *  一度当たりを付けてから引き直す */
function isoFromLocalWallClock(dateString: string, timeString: string): string {
  if (!DATE_RE.test(dateString)) {
    throw new Error(`不正な日付です: ${dateString}`);
  }
  if (!TIME_RE.test(timeString)) {
    throw new Error(`不正な時刻です: ${timeString}`);
  }
  const wallClock = new Date(`${dateString}T${timeString}:00Z`);
  const guess = new Date(wallClock.getTime() - tzOffsetMs(wallClock));
  return new Date(wallClock.getTime() - tzOffsetMs(guess)).toISOString();
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

/** 旅行の作成入力(iOS の TripCreateView と同じ項目)。移動手段は車固定なので持たない */
export type TripInput = {
  title: string;
  /** 出発日 (YYYY-MM-DD)。表示タイムゾーンの壁時計で解釈し、1 日目の日付になる */
  departure_date: string;
  /** 出発時刻 (HH:mm) */
  departure_time: string;
  destination: string | null;
  /** 出発地。null なら出発チェックポイントを作らない(座標はリンクから取れたときだけ) */
  departure_place: {
    name: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
};

// 移動手段は車固定(iOS の TripCreateView と同じ。選択 UI は持たない)
const DEFAULT_TRANSPORT = "car";

/** 旅行を作成する。出発日の 1 日目だけを作り(日数は作成時に決めない)、
 *  出発地が入力されていれば 1 日目の先頭に出発チェックポイントを置く。
 *  started_at / ended_at は null のまま(= プラン中)。
 *  iOS 側 Domain/PlanEditor.makeTrip と対応 */
export function createTrip(input: TripInput): Trip {
  const title = input.title.trim();
  if (!title) throw new Error("タイトルを入力してください");
  const departureAt = isoFromLocalWallClock(
    input.departure_date,
    input.departure_time,
  );
  const place = input.departure_place;
  const departure = place
    ? validateInput({
        type: "departure",
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        planned_time: departureAt,
        note: null,
      })
    : null;
  const db = getDb();
  const now = nowIso();
  const tripId = randomUUID();
  const dayId = randomUUID();
  db.transaction(() => {
    db.prepare(
      `insert into trips
         (id, title, started_at, ended_at, transport, departure_at, destination, updated_at)
       values
         (@id, @title, null, null, @transport, @departure_at, @destination, @updated_at)`,
    ).run({
      id: tripId,
      title,
      transport: DEFAULT_TRANSPORT,
      departure_at: departureAt,
      destination: input.destination?.trim() || null,
      updated_at: now,
    });
    db.prepare(
      `insert into trip_days (id, trip_id, date, updated_at)
       values (@id, @trip_id, @date, @updated_at)`,
    ).run({
      id: dayId,
      trip_id: tripId,
      date: input.departure_date,
      updated_at: now,
    });
    if (departure) {
      db.prepare(
        `insert into checkpoints
           (id, trip_id, trip_day_id, type, name, latitude, longitude,
            planned_time, note, sort_order, updated_at)
         values
           (@id, @trip_id, @trip_day_id, @type, @name, @latitude, @longitude,
            @planned_time, @note, 0, @updated_at)`,
      ).run({
        id: randomUUID(),
        trip_id: tripId,
        trip_day_id: dayId,
        ...departure,
        updated_at: now,
      });
    }
  })();
  return getTrip(tripId);
}

/** 旅行の編集入力(iOS の TripEditView と同じ項目)。移動手段は車固定なので持たない */
export type TripEditInput = {
  title: string;
  /** 出発日 (YYYY-MM-DD)。null なら出発予定を消す */
  departure_date: string | null;
  /** 出発時刻 (HH:mm)。departure_date があるときだけ使う */
  departure_time: string | null;
  destination: string | null;
};

/** 旅行のタイトル・出発予定・目的地を編集する(iOS 側 TripEditView.save と対応)。
 *  **出発日を変えたらプランの各日も同じ日数だけ動く**(チェックポイントの
 *  planned_time も一緒に動く。規則は lib/plan-dates.ts の departureShiftDays) */
export function updateTrip(tripId: string, input: TripEditInput): Trip {
  const trip = getTrip(tripId);
  const title = input.title.trim();
  if (!title) throw new Error("タイトルを入力してください");
  // 出発日時は日付 + 時刻を表示 TZ の壁時計として解釈する(createTrip と同じ)
  const departureAt = input.departure_date
    ? isoFromLocalWallClock(input.departure_date, input.departure_time || "00:00")
    : null;
  const db = getDb();
  const firstDay = db
    .prepare(
      "select min(date) as date from trip_days where trip_id = ? and deleted_at is null",
    )
    .get(tripId) as { date: string | null };
  const offsetDays = departureShiftDays(
    trip.departure_at ? dateStringOf(new Date(trip.departure_at)) : null,
    departureAt ? dateStringOf(new Date(departureAt)) : null,
    firstDay.date,
  );
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `update trips set
         title = @title, transport = @transport, departure_at = @departure_at,
         destination = @destination, updated_at = @now
       where id = @id`,
    ).run({
      id: tripId,
      title,
      // 移動手段は車固定。古い旅行の null もここで揃える(iOS の TripEditView と同じ)
      transport: DEFAULT_TRANSPORT,
      departure_at: departureAt,
      destination: input.destination?.trim() || null,
      now,
    });
    shiftAllDays(tripId, offsetDays, now);
  })();
  return getTrip(tripId);
}

/** 旅行を終了する(iOS 側 LocationRecorder.endTrip と対応。Web は記録しないので
 *  ended_at を入れるだけ)。iOS も進行中のときしかボタンを出さない */
export function endTrip(tripId: string): Trip {
  const trip = getTrip(tripId);
  if (trip.started_at === null) {
    throw new Error("まだ出発していない旅行は終了できません");
  }
  if (trip.ended_at !== null) {
    throw new Error("すでに終了している旅行です");
  }
  const now = nowIso();
  getDb()
    .prepare("update trips set ended_at = @now, updated_at = @now where id = @id")
    .run({ id: tripId, now });
  return getTrip(tripId);
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

/** afterDate より後の日を offsetDays 日ずらす(その日のチェックポイントの
 *  planned_time も同じだけずらす)。呼び出し側のトランザクションの中で使う。
 *  ずらした行だけ updated_at を進める(変わらない行の updated_at を進めて
 *  LWW で他方の編集を潰さないため) */
function shiftDaysAfter(
  tripId: string,
  afterDate: string,
  offsetDays: number,
  now: string,
): void {
  const db = getDb();
  const days = db
    .prepare(
      `select id from trip_days
       where trip_id = ? and date > ? and deleted_at is null`,
    )
    .all(tripId, afterDate) as { id: string }[];
  shiftDays(days, offsetDays, now);
}

/** trip のすべてのプラン日を offsetDays 日ずらす(出発日の変更に追従させる用) */
function shiftAllDays(tripId: string, offsetDays: number, now: string): void {
  const days = getDb()
    .prepare("select id from trip_days where trip_id = ? and deleted_at is null")
    .all(tripId) as { id: string }[];
  shiftDays(days, offsetDays, now);
}

function shiftDays(
  days: { id: string }[],
  offsetDays: number,
  now: string,
): void {
  const db = getDb();
  if (days.length === 0 || offsetDays === 0) return;
  const modifier = offsetDays > 0 ? `+${offsetDays} day` : `${offsetDays} day`;
  const shiftDay = db.prepare(
    "update trip_days set date = date(date, @modifier), updated_at = @now where id = @id",
  );
  const plannedTimes = db.prepare(
    `select id, planned_time from checkpoints
     where trip_day_id = ? and deleted_at is null and planned_time is not null`,
  );
  const shiftCheckpoint = db.prepare(
    `update checkpoints set planned_time = @planned_time, updated_at = @now
     where id = @id`,
  );
  for (const day of days) {
    shiftDay.run({ id: day.id, modifier, now });
    const checkpoints = plannedTimes.all(day.id) as {
      id: string;
      planned_time: string;
    }[];
    for (const checkpoint of checkpoints) {
      shiftCheckpoint.run({
        id: checkpoint.id,
        planned_time: shiftIsoByDays(checkpoint.planned_time, offsetDays),
        now,
      });
    }
  }
}

/** 指定した日の翌日に空の日を差し込む。後続の日は 1 日ずつ後ろへずらすので、
 *  1 日目で実行すれば新しい日が 2 日目になる(日付の重複は起きない)。
 *  最終日で実行した場合はずらす対象が無く、末尾に 1 日増えるだけ */
export function insertTripDayAfter(dayId: string): TripDay {
  const day = getDay(dayId);
  const db = getDb();
  const now = nowIso();
  const id = randomUUID();
  db.transaction(() => {
    shiftDaysAfter(day.trip_id, day.date, 1, now);
    db.prepare(
      `insert into trip_days (id, trip_id, date, updated_at)
       values (@id, @trip_id, @date, @updated_at)`,
    ).run({
      id,
      trip_id: day.trip_id,
      date: nextDate(day.date),
      updated_at: now,
    });
  })();
  return getDay(id);
}

export function updateTripDay(
  dayId: string,
  fields: {
    title: string | null;
    note: string | null;
    /** 前泊地を出発する時刻 "HH:MM"。undefined は現状維持(iOS からの同期値を保持) */
    departure_time?: string | null;
  },
): TripDay {
  const day = getDay(dayId);
  let departureTime = day.departure_time;
  if (fields.departure_time !== undefined) {
    if (fields.departure_time !== null && !TIME_RE.test(fields.departure_time)) {
      throw new Error("出発時刻は HH:MM で指定してください");
    }
    departureTime = fields.departure_time;
  }
  getDb()
    .prepare(
      `update trip_days set
         title = @title, note = @note, departure_time = @departure_time, updated_at = @now
       where id = @id`,
    )
    .run({
      id: dayId,
      title: fields.title?.trim() || null,
      note: fields.note?.trim() || null,
      departure_time: departureTime,
      now: nowIso(),
    });
  return day;
}

/** 旅行を削除する(tombstone)。ぶら下がる日・チェックポイントも道連れにする。
 *  location_points / media は不変(tombstone を持たない)ため行は残す
 *  (親 trip の tombstone で非表示になる) */
export function deleteTrip(tripId: string): Trip {
  const trip = getTrip(tripId);
  const db = getDb();
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `update checkpoints set deleted_at = @now, updated_at = @now
       where trip_id = @id and deleted_at is null`,
    ).run({ id: tripId, now });
    db.prepare(
      `update trip_days set deleted_at = @now, updated_at = @now
       where trip_id = @id and deleted_at is null`,
    ).run({ id: tripId, now });
    db.prepare(
      "update trips set deleted_at = @now, updated_at = @now where id = @id",
    ).run({ id: tripId, now });
  })();
  return trip;
}

/** 日を削除する(tombstone)。ぶら下がるチェックポイントも道連れにし、
 *  後続の日は 1 日前へ詰める(途中の日を消しても日程が連続したままになる)。
 *  最終日ならずらす対象が無い */
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
    shiftDaysAfter(day.trip_id, day.date, -1, now);
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

/** AI 行程提案の採用入力(lib/ai.ts の SuggestedDay に対応) */
export type AdoptDay = {
  /** YYYY-MM-DD */
  date: string;
  title: string | null;
  checkpoints: {
    type: CheckpointType;
    name: string;
    note: string | null;
    /** AI の概算座標(任意)。保存して Google Maps のリンクで具体化したら上書きする */
    latitude?: number | null;
    longitude?: number | null;
  }[];
};

/** AI 提案を採用して trip_days / checkpoints を作成する。
 *  同じ日付の日が既にあればそこへチェックポイントを末尾追記し(title は上書きしない)、
 *  無ければ日を作る。チェックポイントは AI の概算座標付きで入れる(無ければ null) */
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
       (@id, @trip_id, @trip_day_id, @type, @name, @latitude, @longitude,
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
        // 概算座標は片方だけなら両方捨てる(validateInput の対条件に合わせる)
        const hasCoords =
          typeof checkpoint.latitude === "number" &&
          typeof checkpoint.longitude === "number";
        const valid = validateInput({
          type: checkpoint.type,
          name: checkpoint.name,
          latitude: hasCoords ? (checkpoint.latitude as number) : null,
          longitude: hasCoords ? (checkpoint.longitude as number) : null,
          planned_time: null,
          note: checkpoint.note,
        });
        insertCheckpoint.run({
          id: randomUUID(),
          trip_id: tripId,
          trip_day_id: dayId,
          type: valid.type,
          name: valid.name,
          latitude: valid.latitude,
          longitude: valid.longitude,
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

/** AI の日数・宿泊地候補の採用入力(lib/ai.ts の TripOutlineCandidate に対応) */
export type AdoptOutline = {
  /** 旅行全体の日数(日帰りは 1) */
  dayCount: number;
  /** 泊数分。n 番目 = n+1 泊目 = n+1 日目の宿 */
  nights: {
    name: string;
    note: string | null;
    /** AI の概算座標(任意) */
    latitude?: number | null;
    longitude?: number | null;
  }[];
  /** 目的地の概算座標(最終日の destination チェックポイントに使う) */
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
};

/** 座標は片方だけなら両方捨てる(validateInput の対条件に合わせる) */
function coordinatePair(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number | null; longitude: number | null } {
  return typeof latitude === "number" && typeof longitude === "number"
    ? { latitude, longitude }
    : { latitude: null, longitude: null };
}

/** AI の日数・宿泊地候補を採用する。1 日目(既存の最初の日 ?? departure_at ?? 今日)
 *  から dayCount 分の連続した日を揃え(既存の日付は再利用)、最終日に目的地の到着
 *  チェックポイント(trips.destination + 概算座標)を、n 泊目の宿泊チェックポイントを
 *  n 日目に末尾追記する。既存行の updated_at は進めない(LWW で iOS の編集を潰さない
 *  ため)。iOS 側 PlanEditor.adopt(_ candidate:into:) と対応 */
export function adoptTripOutline(tripId: string, outline: AdoptOutline): Trip {
  const trip = getTrip(tripId);
  const dayCount = Math.floor(outline.dayCount);
  if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 30) {
    throw new Error(`不正な日数です: ${outline.dayCount}`);
  }
  const db = getDb();
  const now = nowIso();
  const existingDays = db
    .prepare(
      "select * from trip_days where trip_id = ? and deleted_at is null order by date",
    )
    .all(tripId) as TripDay[];
  const start =
    existingDays[0]?.date ??
    dateStringOf(trip.departure_at ? new Date(trip.departure_at) : new Date());
  const dates = [start];
  while (dates.length < dayCount) {
    dates.push(nextDate(dates[dates.length - 1]));
  }

  const insertDay = db.prepare(
    `insert into trip_days (id, trip_id, date, updated_at)
     values (@id, @trip_id, @date, @updated_at)`,
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
       (@id, @trip_id, @trip_day_id, @type, @name, @latitude, @longitude,
        null, @note, @sort_order, @updated_at)`,
  );

  db.transaction(() => {
    // 日を揃える(既存の日はそのまま。updated_at も進めない)
    const dayIdByDate = new Map<string, string>();
    for (const date of dates) {
      const found = existingDays.find((day) => day.date === date);
      if (found) {
        dayIdByDate.set(date, found.id);
        continue;
      }
      const id = randomUUID();
      insertDay.run({ id, trip_id: tripId, date, updated_at: now });
      dayIdByDate.set(date, id);
    }
    // sort_order は日ごとに既存の末尾から連番(最終日は「到着 → 宿泊」の順)
    const nextOrder = new Map<string, number>();
    const takeOrder = (date: string): number => {
      const dayId = dayIdByDate.get(date)!;
      const order =
        nextOrder.get(date) ??
        ((maxOrder.get(dayId) as { max_order: number | null }).max_order ?? -1) +
          1;
      nextOrder.set(date, order + 1);
      return order;
    };
    const add = (
      date: string,
      input: Omit<CheckpointInput, "planned_time">,
    ): void => {
      const valid = validateInput({ ...input, planned_time: null });
      insertCheckpoint.run({
        id: randomUUID(),
        trip_id: tripId,
        trip_day_id: dayIdByDate.get(date)!,
        type: valid.type,
        name: valid.name,
        latitude: valid.latitude,
        longitude: valid.longitude,
        note: valid.note,
        sort_order: takeOrder(date),
        updated_at: now,
      });
    };

    const destination = trip.destination?.trim();
    if (destination) {
      add(dates[dates.length - 1], {
        type: "destination",
        name: destination,
        ...coordinatePair(
          outline.destinationLatitude,
          outline.destinationLongitude,
        ),
        note: null,
      });
    }
    // nights[n] = n+1 泊目 = n+1 日目の宿。日数を超える分は捨てる
    outline.nights.slice(0, dates.length).forEach((night, index) => {
      if (!night.name.trim()) return;
      add(dates[index], {
        type: "lodging",
        name: night.name,
        ...coordinatePair(night.latitude, night.longitude),
        note: night.note,
      });
    });
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
