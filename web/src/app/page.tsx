import Link from "next/link";
import { Header } from "./header";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { tripStatus, type Trip } from "@/lib/types";

type TripListRow = Pick<Trip, "id" | "title" | "started_at" | "ended_at"> & {
  point_count: number;
};

// DB はリクエスト時に読む(ビルド時に静的化しない)
export const dynamic = "force-dynamic";

export default function Home() {
  // プラン中(未出発)を先頭に、あとは開始日時の新しい順
  const trips = getDb()
    .prepare(
      `select t.id, t.title, t.started_at, t.ended_at, count(p.id) as point_count
       from trips t
       left join location_points p on p.trip_id = t.id
       where t.deleted_at is null
       group by t.id
       order by t.started_at is null desc, t.started_at desc`,
    )
    .all() as TripListRow[];

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-xl font-semibold">旅行</h1>
        {trips.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">
            まだ記録がありません。iOS アプリで記録して同期するとここに表示されます。
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className="flex flex-col gap-1 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="flex items-center gap-2 font-medium">
                    {trip.title}
                    {tripStatus(trip) === "in_progress" && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
                        進行中
                      </span>
                    )}
                    {tripStatus(trip) === "planning" && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        プラン中
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {trip.started_at ? formatDateTime(trip.started_at) : "未出発"}
                    {" · "}
                    {trip.point_count} 地点
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
