import Link from "next/link";
import { TripCreateForm } from "./trip-create-form";
import { Header } from "../../header";
import { TIME_ZONE } from "@/lib/format";
import { dateStringOf, timeStringOf } from "@/lib/plan";

// 旅行の作成。出発日時の初期値は表示タイムゾーンの「今」にする
// (入力も同じタイムゾーンの壁時計として解釈されるので、見た通りの値になる)
export const dynamic = "force-dynamic";

export default function NewTripPage() {
  const now = new Date();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Link
          href="/"
          className="text-sm text-muted hover:underline"
        >
          ← 旅行一覧
        </Link>
        <h1 className="mt-2 mb-4 text-xl font-semibold">旅行を作成</h1>
        <TripCreateForm
          defaultDate={dateStringOf(now)}
          defaultTime={timeStringOf(now)}
          timeZone={TIME_ZONE}
        />
      </main>
    </>
  );
}
