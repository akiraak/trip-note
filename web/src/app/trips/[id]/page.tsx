import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "../../header";
import { PlanSection, type PlanDay } from "./plan-section";
import { TripMap } from "./trip-map";
import { transportLabel } from "@/lib/checkpoint-style";
import { getDb } from "@/lib/db";
import { formatDateTime, formatPointTime } from "@/lib/format";
import { formatDistance, totalDistance } from "@/lib/geo";
import {
  tripStatus,
  type Checkpoint,
  type LocationPoint,
  type Media,
  type Trip,
  type TripDay,
} from "@/lib/types";

export default async function TripDetailPage(props: PageProps<"/trips/[id]">) {
  const { id } = await props.params;
  const db = getDb();
  const trip = db
    .prepare("select * from trips where id = ? and deleted_at is null")
    .get(id) as Trip | undefined;
  if (!trip) {
    notFound();
  }
  const status = tripStatus(trip);
  const points = db
    .prepare(
      "select * from location_points where trip_id = ? order by recorded_at",
    )
    .all(id) as LocationPoint[];
  const distance = totalDistance(points);
  // 地図マーカー用に紐付いた点の座標も引く(点が無いメディアはグリッドのみ)
  const media = db
    .prepare(
      `select m.*, p.latitude, p.longitude
       from media m
       left join location_points p on p.id = m.location_point_id
       where m.trip_id = ? order by m.taken_at`,
    )
    .all(id) as (Media & { latitude: number | null; longitude: number | null })[];
  const mediaMarkers = media
    .filter((m) => m.latitude !== null && m.longitude !== null)
    .map((m) => ({
      id: m.id,
      type: m.type,
      latitude: m.latitude as number,
      longitude: m.longitude as number,
    }));

  // プラン(日別チェックポイント)。tombstone は表示しない
  const days = db
    .prepare(
      "select * from trip_days where trip_id = ? and deleted_at is null order by date",
    )
    .all(id) as TripDay[];
  const checkpoints = db
    .prepare(
      `select * from checkpoints where trip_id = ? and deleted_at is null
       order by sort_order, created_at`,
    )
    .all(id) as Checkpoint[];
  const checkpointsByDay = new Map<string, Checkpoint[]>();
  for (const checkpoint of checkpoints) {
    const list = checkpointsByDay.get(checkpoint.trip_day_id) ?? [];
    list.push(checkpoint);
    checkpointsByDay.set(checkpoint.trip_day_id, list);
  }
  const planDays: PlanDay[] = days.map((day) => ({
    id: day.id,
    date: day.date,
    title: day.title,
    note: day.note,
    checkpoints: (checkpointsByDay.get(day.id) ?? []).map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      latitude: c.latitude,
      longitude: c.longitude,
      planned_time: c.planned_time,
      note: c.note,
    })),
  }));
  const checkpointMarkers = checkpoints
    .filter((c) => c.latitude !== null && c.longitude !== null)
    .map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      latitude: c.latitude as number,
      longitude: c.longitude as number,
    }));

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← 旅行一覧
        </Link>
        <h1 className="mt-2 mb-4 flex items-center gap-2 text-xl font-semibold">
          {trip.title}
          {status === "in_progress" && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
              進行中
            </span>
          )}
          {status === "planning" && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              プラン中
            </span>
          )}
        </h1>
        {(points.length > 0 || checkpointMarkers.length > 0) && (
          <div className="mb-6">
            <TripMap
              points={points.map((p) => ({
                latitude: p.latitude,
                longitude: p.longitude,
                recorded_at: p.recorded_at,
              }))}
              media={mediaMarkers}
              checkpoints={checkpointMarkers}
            />
          </div>
        )}
        <dl className="mb-8 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">開始</dt>
            <dd>
              {trip.started_at ? formatDateTime(trip.started_at) : "未出発"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">終了</dt>
            <dd>
              {trip.ended_at
                ? formatDateTime(trip.ended_at)
                : status === "in_progress"
                  ? "進行中"
                  : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">移動手段</dt>
            <dd>{transportLabel(trip.transport) ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">地点数</dt>
            <dd>{points.length}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">総距離</dt>
            <dd>{formatDistance(distance)}</dd>
          </div>
        </dl>
        <h2 className="mb-2 font-medium">プラン</h2>
        <div className="mb-8">
          <PlanSection tripId={trip.id} days={planDays} />
        </div>
        {media.length > 0 && (
          <>
            <h2 className="mb-2 font-medium">メディア</h2>
            <ul className="mb-8 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {media.map((m) => (
                <li key={m.id}>
                  {m.type === "photo" ? (
                    <a
                      href={`/media/${m.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      {/* 認証付き動的配信のため next/image は使わない */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/media/${m.id}`}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    </a>
                  ) : (
                    <video
                      src={`/media/${m.id}`}
                      controls
                      preload="metadata"
                      playsInline
                      className="aspect-square w-full rounded-md bg-black object-cover"
                    />
                  )}
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {formatPointTime(m.taken_at)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        <h2 className="mb-2 font-medium">タイムライン</h2>
        {points.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">
            位置情報がありません
          </p>
        ) : (
          <ol className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {points.map((point) => (
              <li key={point.id} className="flex flex-col gap-0.5 py-2">
                <span>{formatPointTime(point.recorded_at)}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
                  {point.altitude !== null &&
                    ` · 高度 ${Math.round(point.altitude)} m`}
                  {point.accuracy !== null &&
                    ` · ±${Math.round(point.accuracy)} m`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
