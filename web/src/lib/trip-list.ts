import { getDb } from "./db";
import { totalDistance } from "./geo";
import type { Coordinate } from "./plan-map";

// 旅行一覧に出す情報の組み立て。iOS の ContentView(旅行一覧)と同じ項目を出す:
// タイトル・状態・開始日時・地点数・総距離、プラン中は「N月N日 から N 日間」。
// あわせてルートサムネイル用の座標列も返す(記録があれば軌跡の間引き、無ければプランの
// チェックポイント。iOS の TripEntity.thumbnailRoute と同じ規則)

const THUMBNAIL_POINTS = 60;

export type TripListEntry = {
  id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  point_count: number;
  distance_meters: number;
  day_count: number;
  /** プランの初日(YYYY-MM-DD)。日が無ければ null */
  first_date: string | null;
  route: Coordinate[];
};

type TripRow = Pick<
  TripListEntry,
  "id" | "title" | "started_at" | "ended_at" | "day_count" | "first_date"
>;

type TripCoordinate = Coordinate & { trip_id: string };

/** 形を保ったまま描画点数を抑える(iOS の RouteThumbnail.sampled と同じ) */
function sampled(coordinates: Coordinate[]): Coordinate[] {
  if (coordinates.length <= THUMBNAIL_POINTS) return coordinates;
  const step = (coordinates.length - 1) / (THUMBNAIL_POINTS - 1);
  return Array.from(
    { length: THUMBNAIL_POINTS },
    (_, index) => coordinates[Math.round(index * step)],
  );
}

function groupByTrip(rows: TripCoordinate[]): Map<string, Coordinate[]> {
  const grouped = new Map<string, Coordinate[]>();
  for (const row of rows) {
    const list = grouped.get(row.trip_id) ?? [];
    list.push({ latitude: row.latitude, longitude: row.longitude });
    grouped.set(row.trip_id, list);
  }
  return grouped;
}

export function listTrips(): TripListEntry[] {
  const db = getDb();
  // プラン中(未出発)を先頭に、あとは開始日時の新しい順
  const trips = db
    .prepare(
      `select t.id, t.title, t.started_at, t.ended_at,
         (select count(*) from trip_days d
           where d.trip_id = t.id and d.deleted_at is null) as day_count,
         (select min(d.date) from trip_days d
           where d.trip_id = t.id and d.deleted_at is null) as first_date
       from trips t
       where t.deleted_at is null
       order by t.started_at is null desc, t.started_at desc`,
    )
    .all() as TripRow[];

  // 記録点は旅行ごとにまとめて 1 回で読む(地点数・総距離・サムネイルに使う)
  const recorded = groupByTrip(
    db
      .prepare(
        `select p.trip_id, p.latitude, p.longitude
         from location_points p
         join trips t on t.id = p.trip_id
         where t.deleted_at is null
         order by p.trip_id, p.recorded_at`,
      )
      .all() as TripCoordinate[],
  );
  // 記録の無い旅行はプランのチェックポイントで形を出す(日付順 → 日内 sort_order 順)
  const planned = groupByTrip(
    db
      .prepare(
        `select c.trip_id, c.latitude, c.longitude
         from checkpoints c
         join trip_days d on d.id = c.trip_day_id
         where c.deleted_at is null and d.deleted_at is null
           and c.latitude is not null and c.longitude is not null
         order by c.trip_id, d.date, c.sort_order, c.created_at`,
      )
      .all() as TripCoordinate[],
  );

  return trips.map((trip) => {
    const points = recorded.get(trip.id) ?? [];
    return {
      ...trip,
      point_count: points.length,
      distance_meters: totalDistance(points),
      route:
        points.length > 0 ? sampled(points) : (planned.get(trip.id) ?? []),
    };
  });
}
