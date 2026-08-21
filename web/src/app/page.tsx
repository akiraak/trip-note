import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "./header";
import { formatDateTime } from "@/lib/format";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Trip } from "@/lib/types";

type TripListRow = Pick<Trip, "id" | "title" | "started_at" | "ended_at"> & {
  location_points: { count: number }[];
};

// env 未設定でビルドした場合に SetupNotice が静的に焼き込まれないよう常に動的レンダリングする
export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 通常は proxy がリダイレクトするが、直アクセスに備えて二重に守る
  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("trips")
    .select("id, title, started_at, ended_at, location_points(count)")
    .order("started_at", { ascending: false });
  if (error) {
    throw new Error(`旅行の取得に失敗しました: ${error.message}`);
  }
  const trips = (data ?? []) as TripListRow[];

  return (
    <>
      <Header email={user.email ?? null} />
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
                    {trip.ended_at === null && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
                        記録中
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {formatDateTime(trip.started_at)} ·{" "}
                    {trip.location_points[0]?.count ?? 0} 地点
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

function SetupNotice() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16">
      <h1 className="mb-4 text-xl font-semibold">trip-note</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Supabase が未設定です。<code>web/.env.example</code> を元に{" "}
        <code>web/.env.local</code> を作成してください（
        <code>supabase/README.md</code> 参照）。
      </p>
    </main>
  );
}
