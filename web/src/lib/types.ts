// web/src/lib/db.ts のスキーマに対応する行の型
export type Trip = {
  id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
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
