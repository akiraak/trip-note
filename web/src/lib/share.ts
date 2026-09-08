import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { simplifyTrack } from "./geo";
import { dateStringOf } from "./plan";
import { buildLegs, legKey, type ResolvedLeg } from "./route-legs";
import { readCachedLegs } from "./routing";
import { dayMapPoints } from "./plan-map";
import { type ShareSummary } from "./share-summary";
import { readTripPlan, type CheckpointMarker, type PlanRoutePoint } from "./trip-plan";
import type { Media, Trip } from "./types";

// 共有リンク(docs/plans/share-page.md)。
// 旅行ごとに推測できないトークンを発行し、/share/<token> でログイン不要に工程と写真を見せる。
// trips.share_token はサーバ専用の列で iOS には同期しない(/api/sync の push・pull は列を明示している)。
// 発行・停止で updated_at は動かさない(iOS との LWW に影響させない)。
//
// 共有ページは「先頭に旅行全体の地図、その下に日ごとのカード(その日の地図・立ち寄り先・写真)」
// という形なので、読み出しもその単位に組み直して返す
// (docs/plans/share-page-redesign.md)。

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
};

/** 1 日分。地図・立ち寄り先・写真をこの単位で出す */
export type SharedDay = {
  id: string;
  date: string;
  /** 訪問順の立ち寄り先の名前(座標の有無に関わらず全部) */
  places: string[];
  /** その日の地図に置くチェックポイント(座標のあるものだけ) */
  markers: CheckpointMarker[];
  /** その日のルートの起点(前の日の最後の座標つきチェックポイント)。無ければ null */
  anchor: PlanRoutePoint | null;
  /** その日の記録点が points のどこからどこまでか(点を日ごとに複製しないための範囲) */
  trackStart: number;
  trackEnd: number;
  /** その日に撮った写真・動画(撮影の古い順。その日の流れに沿って読ませる) */
  media: SharedMedia[];
};

export type SharedTrip = {
  trip: Pick<
    Trip,
    "id" | "title" | "started_at" | "ended_at" | "departure_at" | "destination"
  >;
  /** 旅行全体の記録点(先頭の地図用。日ごとの地図は trackStart/trackEnd で切り出す)。
   *  **表示用に間引いてある**ので、距離や件数の計算には使わないこと */
  points: SharedTrackPoint[];
  /** 旅行全体のチェックポイント(先頭の地図用) */
  markers: CheckpointMarker[];
  /** 旅行全体のプランのルート(先頭の地図用) */
  route: PlanRoutePoint[];
  days: SharedDay[];
  /** どの日にも入らなかった写真・動画(日を消した後に残った分など。黙って落とさない) */
  otherMedia: SharedMedia[];
  photoCount: number;
  videoCount: number;
  /** キャッシュ済みの道路形状レグだけ(公開経路からは OSRM を呼ばない) */
  cachedLegs: Record<string, ResolvedLeg>;
};

/** 表示タイムゾーンでの YYYY-MM-DD。読めない値は null(どの日にも入れない) */
function dayKeyOf(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dateStringOf(date);
}

export function readSharedTrip(token: string): SharedTrip | null {
  const trip = findSharedTrip(token);
  if (!trip) return null;
  const db = getDb();
  // 記録点は数万件になり得る。共有ページは線の形しか使わないので、表示用に間引いてから
  // 渡す(そのままだとページが十数 MB になり、リンクを開く人の通信量になる)。
  // 座標も 5 桁(約 1m)に丸める
  const recorded = db
    .prepare(
      `select latitude, longitude, recorded_at from location_points
       where trip_id = ? order by recorded_at`,
    )
    .all(trip.id) as SharedTrackPoint[];
  const points: SharedTrackPoint[] = simplifyTrack(recorded).map((point) => ({
    latitude: Math.round(point.latitude * 1e5) / 1e5,
    longitude: Math.round(point.longitude * 1e5) / 1e5,
    recorded_at: point.recorded_at,
  }));
  const media = db
    .prepare(
      `select id, type, taken_at from media
       where trip_id = ? and deleted_at is null
       order by taken_at, id`,
    )
    .all(trip.id) as SharedMedia[];
  const plan = readTripPlan(trip.id);

  // 記録点は撮影時刻順に並んでいるので、日ごとの範囲は連続した区間になる。
  // 数万点になり得るので日ごとに複製せず、範囲(添字)だけを持たせる
  const ranges = new Map<string, { start: number; end: number }>();
  for (const [index, point] of points.entries()) {
    const key = dayKeyOf(point.recorded_at);
    if (!key) continue;
    const range = ranges.get(key);
    if (range) {
      range.end = index + 1;
    } else {
      ranges.set(key, { start: index, end: index + 1 });
    }
  }

  // 写真・動画も日ごとに配る。どの日にも当たらなかった分は otherMedia へ回す
  const mediaByDay = new Map<string, SharedMedia[]>();
  const dates = new Set(plan.days.map((day) => day.date));
  const otherMedia: SharedMedia[] = [];
  for (const item of media) {
    const key = dayKeyOf(item.taken_at);
    if (!key || !dates.has(key)) {
      otherMedia.push(item);
      continue;
    }
    const list = mediaByDay.get(key) ?? [];
    list.push(item);
    mediaByDay.set(key, list);
  }

  // その日のルートの起点(前泊地)は旅行詳細と同じ規則(lib/plan-map.ts)
  const maps = dayMapPoints(plan.days);
  const days: SharedDay[] = plan.days.map((day, index) => {
    const range = ranges.get(day.date);
    return {
      id: day.id,
      date: day.date,
      places: day.checkpoints.map((checkpoint) => checkpoint.name),
      markers: maps[index].points.map((point) => ({
        id: point.id,
        type: point.type,
        name: point.name,
        latitude: point.latitude,
        longitude: point.longitude,
      })),
      anchor: maps[index].anchor,
      trackStart: range?.start ?? 0,
      trackEnd: range?.end ?? 0,
      media: mediaByDay.get(day.date) ?? [],
    };
  });

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
    markers: plan.markers,
    route: plan.route,
    days,
    otherMedia,
    photoCount: media.filter((item) => item.type === "photo").length,
    videoCount: media.filter((item) => item.type === "video").length,
    cachedLegs,
  };
}

/** OGP タグ用の軽い読み出しの結果。ページ本体(readSharedTrip)は記録点を全部読むので分けてある */
export type ShareMeta = ShareSummary & {
  title: string;
  /** プレビュー画像に使う写真の id(旅行の最初の 1 枚)。写真が無ければ null */
  coverMediaId: string | null;
};

/// OGP タグを組むのに要る分だけを読む。generateMetadata から呼ぶので、
/// 記録点やプランは読まない(readSharedTrip と同じ処理を 2 回走らせないため)
export function readShareMeta(token: string): ShareMeta | null {
  const trip = findSharedTrip(token);
  if (!trip) return null;
  const db = getDb();
  const days = db
    .prepare(
      `select count(*) as count, min(date) as first, max(date) as last
       from trip_days where trip_id = ? and deleted_at is null`,
    )
    .get(trip.id) as { count: number; first: string | null; last: string | null };
  const counts = db
    .prepare(
      `select type, count(*) as count from media
       where trip_id = ? and deleted_at is null group by type`,
    )
    .all(trip.id) as { type: "photo" | "video"; count: number }[];
  // プレビューは旅行の最初の写真(動画はプレビュー画像にできない)
  const cover = db
    .prepare(
      `select id from media
       where trip_id = ? and deleted_at is null and type = 'photo'
       order by taken_at, id limit 1`,
    )
    .get(trip.id) as { id: string } | undefined;
  return {
    title: trip.title,
    firstDate: days.first,
    lastDate: days.last,
    dayCount: days.count,
    photoCount: counts.find((row) => row.type === "photo")?.count ?? 0,
    videoCount: counts.find((row) => row.type === "video")?.count ?? 0,
    coverMediaId: cover?.id ?? null,
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
