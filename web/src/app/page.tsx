import Link from "next/link";
import { Header } from "./header";
import { RouteThumbnail } from "./route-thumbnail";
import { formatDateTime, formatDay } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { listTrips, type TripListEntry } from "@/lib/trip-list";
import { tripStatus } from "@/lib/types";

// DB はリクエスト時に読む(ビルド時に静的化しない)
export const dynamic = "force-dynamic";

export default function Home() {
  const trips = listTrips();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="tabular text-xs tracking-[0.18em] text-muted uppercase">
            Trips
          </h1>
          <Link
            href="/trips/new"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:brightness-110"
          >
            旅行を作成
          </Link>
        </div>
        {trips.length === 0 ? (
          <p className="text-muted">
            まだ旅行がありません。「旅行を作成」から始めるか、iOS
            アプリで記録して同期するとここに表示されます。
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className="flex h-[92px] overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-accent"
                >
                  <RouteThumbnail
                    points={trip.route}
                    color={
                      trip.started_at === null ? "var(--accent)" : "var(--done)"
                    }
                    className="h-full w-24 shrink-0"
                  />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate">{trip.title}</span>
                      {tripStatus(trip) === "in_progress" && (
                        <span className="tabular shrink-0 rounded-full bg-done/15 px-2 py-0.5 text-[11px] text-done">
                          進行中
                        </span>
                      )}
                      {tripStatus(trip) === "planning" && (
                        <span className="tabular shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                          プラン中
                        </span>
                      )}
                    </span>
                    <span className="tabular truncate text-xs text-muted">
                      {summary(trip)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

/** 一覧の 2 行目(iOS の TripRow と同じ項目・同じ順番) */
function summary(trip: TripListEntry): string {
  if (trip.started_at) {
    return [
      formatDateTime(trip.started_at),
      `${trip.point_count} 地点`,
      formatDistance(trip.distance_meters),
    ].join(" · ");
  }
  // プラン中はプランの期間を出す(地点数・距離は 0 なので出さない)
  if (trip.first_date) {
    return `${formatDay(trip.first_date)} から ${trip.day_count} 日間`;
  }
  return "未出発";
}
