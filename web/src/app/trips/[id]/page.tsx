import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Header } from "../../header";
import { formatDateTime, formatPointTime } from "@/lib/format";
import { formatDistance, totalDistance } from "@/lib/geo";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { LocationPoint, Trip } from "@/lib/types";

// PostgREST は 1 リクエストあたり最大 1000 行(既定)のため range で全件取得する
const PAGE_SIZE = 1000;

async function fetchAllPoints(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
): Promise<LocationPoint[]> {
  const points: LocationPoint[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("location_points")
      .select("*")
      .eq("trip_id", tripId)
      .order("recorded_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`位置情報の取得に失敗しました: ${error.message}`);
    }
    const batch = (data ?? []) as LocationPoint[];
    points.push(...batch);
    if (batch.length < PAGE_SIZE) {
      return points;
    }
  }
}

export default async function TripDetailPage(
  props: PageProps<"/trips/[id]">,
) {
  if (!isSupabaseConfigured()) {
    redirect("/");
  }

  const { id } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`旅行の取得に失敗しました: ${error.message}`);
  }
  if (!data) {
    notFound();
  }
  const trip = data as Trip;
  const points = await fetchAllPoints(supabase, id);
  const distance = totalDistance(points);

  return (
    <>
      <Header email={user.email ?? null} />
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
