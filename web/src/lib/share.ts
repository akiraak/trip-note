import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { buildLegs, legKey, type ResolvedLeg } from "./route-legs";
import { readCachedLegs } from "./routing";
import { readTripPlan, type TripPlan } from "./trip-plan";
import type { Media, Trip } from "./types";

// 共有リンク(docs/plans/share-page.md)。
// 旅行ごとに推測できないトークンを発行し、/share/<token> でログイン不要に工程と写真を見せる。
// trips.share_token はサーバ専用の列で iOS には同期しない(/api/sync の push・pull は列を明示している)。
// 発行・停止で updated_at は動かさない(iOS との LWW に影響させない)

/** URL に入るトークンの形(base64url 16〜64 文字)。これに合わない値は DB を引かずに弾く */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** 18 バイト(144 bit)を base64url にした 24 文字。推測できず、URL に収まる長さ */
export function generateShareToken(): string {
  return randomBytes(18).toString("base64url");
}

function getTrip(tripId: string): Trip {
  const trip = getDb()
    .prepare("select * from trips where id = ? and deleted_at is null")
    .get(tripId) as Trip | undefined;
  if (!trip) throw new Error("旅行が見つかりません");
  return trip;
}

/// 共有リンクを発行する。既に発行済みなら同じトークンを返す(冪等)
export function issueShareToken(tripId: string): string {
  const trip = getTrip(tripId);
  if (trip.share_token) return trip.share_token;
  const token = generateShareToken();
  getDb()
    .prepare("update trips set share_token = ? where id = ?")
    .run(token, tripId);
  return token;
}

/// 共有を停止する。リンクは即座に 404 になり、発行し直すと別の URL になる。未発行でも成功扱い
export function revokeShareToken(tripId: string): void {
  getTrip(tripId);
  getDb()
    .prepare("update trips set share_token = null where id = ?")
    .run(tripId);
}

/// トークンに対応する(削除済みでない)旅行。形式外・不一致・停止済みは null
export function findSharedTrip(token: string): Trip | null {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const trip = getDb()
    .prepare("select * from trips where share_token = ? and deleted_at is null")
    .get(token) as Trip | undefined;
  return trip ?? null;
}

export type SharedTrackPoint = {
  latitude: number;
  longitude: number;
  recorded_at: string;
};

export type SharedMedia = {
  id: string;
  type: "photo" | "video";
  taken_at: string;
  /** 地図マーカー用の座標。メディア自身の撮影位置を優先し、無ければ紐付いた記録点(どちらも無ければ null) */
  marker: { latitude: number; longitude: number } | null;
};

/** 共有ページに出す情報。Web 旅行詳細(trips/[id]/page.tsx)と同じ集合から組む */
export type SharedTrip = {
  trip: Pick<
    Trip,
    "id" | "title" | "started_at" | "ended_at" | "departure_at" | "destination"
  >;
  points: SharedTrackPoint[];
  /** 撮影・追加時刻の新しい順(旅行詳細・iOS の sortedMedia と同じ) */
  media: SharedMedia[];
  plan: TripPlan;
  /** キャッシュ済みの道路形状レグだけ(公開経路からは OSRM を呼ばせない) */
  cachedLegs: Record<string, ResolvedLeg>;
};

export function readSharedTrip(token: string): SharedTrip | null {
  const trip = findSharedTrip(token);
  if (!trip) return null;
  const db = getDb();
  const points = db
    .prepare(
      `select latitude, longitude, recorded_at from location_points
       where trip_id = ? order by recorded_at`,
    )
    .all(trip.id) as SharedTrackPoint[];
  const mediaRows = db
    .prepare(
      `select m.id, m.type, m.taken_at,
              coalesce(m.latitude, p.latitude) as marker_latitude,
              coalesce(m.longitude, p.longitude) as marker_longitude
       from media m
       left join location_points p on p.id = m.location_point_id
       where m.trip_id = ? and m.deleted_at is null
       order by m.taken_at desc, m.id desc`,
    )
    .all(trip.id) as {
    id: string;
    type: "photo" | "video";
    taken_at: string;
    marker_latitude: number | null;
    marker_longitude: number | null;
  }[];
  const plan = readTripPlan(trip.id);
  const cachedLegs = readCachedLegs(
    buildLegs({ points: plan.route }).map((leg) => legKey(leg.from, leg.to)),
  );
  return {
    trip: {
      id: trip.id,
      title: trip.title,
      started_at: trip.started_at,
      ended_at: trip.ended_at,
      departure_at: trip.departure_at,
      destination: trip.destination,
    },
    points,
    media: mediaRows.map((row) => ({
      id: row.id,
      type: row.type,
      taken_at: row.taken_at,
      marker:
        row.marker_latitude !== null && row.marker_longitude !== null
          ? { latitude: row.marker_latitude, longitude: row.marker_longitude }
          : null,
    })),
    plan,
    cachedLegs,
  };
}

/// 共有ページ向けのメディア。そのトークンの(削除済みでない)旅行に属する、削除済みでないメディアだけ
export function readSharedMedia(token: string, mediaId: string): Media | null {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const row = getDb()
    .prepare(
      `select m.* from media m
         join trips t on t.id = m.trip_id
       where m.id = ? and t.share_token = ?
         and t.deleted_at is null and m.deleted_at is null`,
    )
    .get(mediaId, token) as Media | undefined;
  return row ?? null;
}
