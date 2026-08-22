import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "../../header";
import { TripMap } from "./trip-map";
import { getDb } from "@/lib/db";
import { formatDateTime, formatPointTime } from "@/lib/format";
import { formatDistance, totalDistance } from "@/lib/geo";
import type { LocationPoint, Media, Trip } from "@/lib/types";

export default async function TripDetailPage(props: PageProps<"/trips/[id]">) {
  const { id } = await props.params;
  const db = getDb();
  const trip = db.prepare("select * from trips where id = ?").get(id) as
    | Trip
    | undefined;
  if (!trip) {
    notFound();
  }
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
          {trip.ended_at === null && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
              記録中
            </span>
          )}
        </h1>
        {points.length > 0 && (
          <div className="mb-6">
            <TripMap
              points={points.map((p) => ({
                latitude: p.latitude,
                longitude: p.longitude,
              }))}
              media={mediaMarkers}
            />
          </div>
        )}
        <dl className="mb-8 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">開始</dt>
            <dd>{formatDateTime(trip.started_at)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">終了</dt>
            <dd>{trip.ended_at ? formatDateTime(trip.ended_at) : "記録中"}</dd>
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
