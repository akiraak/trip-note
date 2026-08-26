import { getDb } from "./db";
import type { Checkpoint, CheckpointType, TripDay } from "./types";

// 旅行詳細で使うプラン(日 + チェックポイント)の読み出し。
// 日カード・地図のピン・破線ルートを**同じ 1 つの集合**から組み立てる。
//
// tombstone は日・チェックポイントの両方を見る。親の日が削除済みなのに
// チェックポイントが生きている行(同期の LWW 競合で生まれ得る。孤児 CP)は
// どこにも出さない: 片方だけに出ると「削除したのに地図のピンだけ残る」ことになる
// (docs/plans/deleted-checkpoint-on-map.md)。Web 一覧のミニ地図(lib/trip-list.ts)と
// iOS(日経由で辿る)も同じ規則。

export type PlanCheckpoint = {
  id: string;
  type: CheckpointType;
  name: string;
  latitude: number | null;
  longitude: number | null;
  planned_time: string | null;
  note: string | null;
};

export type PlanDay = {
  id: string;
  date: string;
  title: string | null;
  note: string | null;
  /** 前泊地を出発する時刻 "HH:MM"(iOS で設定して同期されてくる) */
  departure_time: string | null;
  checkpoints: PlanCheckpoint[];
};

/** 地図のピン 1 件(座標のあるチェックポイントだけ) */
export type CheckpointMarker = {
  id: string;
  type: CheckpointType;
  name: string;
  latitude: number;
  longitude: number;
};

export type PlanRoutePoint = { latitude: number; longitude: number };

export type TripPlan = {
  /** 日カード用(座標の無いチェックポイントも「座標未設定」として出す) */
  days: PlanDay[];
  /** 地図のピン(日付順 → 日内 sort_order 順) */
  markers: CheckpointMarker[];
  /** 破線ルートの座標列(markers と同じ並び) */
  route: PlanRoutePoint[];
};

/** 旅行のプランを読む。tombstone(日・チェックポイントとも)は含めない */
export function readTripPlan(tripId: string): TripPlan {
  const db = getDb();
  const days = db
    .prepare(
      "select * from trip_days where trip_id = ? and deleted_at is null order by date",
    )
    .all(tripId) as TripDay[];
  // 日を join して、親が tombstone のチェックポイントを落とす。
  // 並びは日付順 → 日内 sort_order 順(そのままルートの訪問順になる)
  const checkpoints = db
    .prepare(
      `select c.* from checkpoints c
         join trip_days d on d.id = c.trip_day_id
       where c.trip_id = ? and c.deleted_at is null and d.deleted_at is null
       order by d.date, c.sort_order, c.created_at`,
    )
    .all(tripId) as Checkpoint[];

  const byDay = new Map<string, PlanCheckpoint[]>();
  for (const checkpoint of checkpoints) {
    const list = byDay.get(checkpoint.trip_day_id) ?? [];
    list.push({
      id: checkpoint.id,
      type: checkpoint.type,
      name: checkpoint.name,
      latitude: checkpoint.latitude,
      longitude: checkpoint.longitude,
      planned_time: checkpoint.planned_time,
      note: checkpoint.note,
    });
    byDay.set(checkpoint.trip_day_id, list);
  }

  // 地図に置けるのは座標が両方そろっているものだけ(片方だけ・null は飛ばす)
  const located = checkpoints.filter(
    (checkpoint) => checkpoint.latitude !== null && checkpoint.longitude !== null,
  );

  return {
    days: days.map((day) => ({
      id: day.id,
      date: day.date,
      title: day.title,
      note: day.note,
      departure_time: day.departure_time,
      checkpoints: byDay.get(day.id) ?? [],
    })),
    markers: located.map((checkpoint) => ({
      id: checkpoint.id,
      type: checkpoint.type,
      name: checkpoint.name,
      latitude: checkpoint.latitude as number,
      longitude: checkpoint.longitude as number,
    })),
    route: located.map((checkpoint) => ({
      latitude: checkpoint.latitude as number,
      longitude: checkpoint.longitude as number,
    })),
  };
}
