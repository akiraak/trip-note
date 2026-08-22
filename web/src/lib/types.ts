// web/src/lib/db.ts のスキーマに対応する行の型
export type Trip = {
  id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  transport: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

// 旅行の状態は status カラムを持たず導出する(同期の競合対象を減らす)
export type TripStatus = "planning" | "in_progress" | "finished";

export function tripStatus(
  trip: Pick<Trip, "started_at" | "ended_at">,
): TripStatus {
  if (trip.started_at === null) return "planning";
  if (trip.ended_at === null) return "in_progress";
  return "finished";
}

// チェックポイントの種別。出発地は 1 日目の departure、到着予定地は最終日の
// destination として表現する(trips にはカラムを持たない)
export const CHECKPOINT_TYPES = [
  "departure",
  "destination",
  "sightseeing",
  "cafe",
  "restaurant",
  "lodging",
  "other",
] as const;

export type CheckpointType = (typeof CHECKPOINT_TYPES)[number];

export type TripDay = {
  id: string;
  trip_id: string;
  /** YYYY-MM-DD */
  date: string;
  /** 大まかな行程(例: 松本周辺を観光して泊) */
  title: string | null;
  note: string | null;
  updated_at: string;
  deleted_at: string | null;
  created_at: string;
};

export type Checkpoint = {
  id: string;
  trip_id: string;
  trip_day_id: string;
  type: CheckpointType;
  name: string;
  /** 地域だけ決まっていて座標未定なら null */
  latitude: number | null;
  longitude: number | null;
  /** ISO8601 任意(立ち寄り予定時刻など) */
  planned_time: string | null;
  note: string | null;
  sort_order: number;
  updated_at: string;
  deleted_at: string | null;
  created_at: string;
};

export type Media = {
  id: string;
  trip_id: string;
  location_point_id: string | null;
  type: "photo" | "video";
  storage_path: string;
  taken_at: string;
  created_at: string;
};

export type LocationPoint = {
  id: string;
  trip_id: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  recorded_at: string;
  created_at: string;
};
