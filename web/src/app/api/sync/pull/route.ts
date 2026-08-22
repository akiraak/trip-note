import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { getDb } from "@/lib/db";

// iOS がプラン系(trips / trip_days / checkpoints)の変更を取り込むための
// pull エンドポイント。`?since=<ISO8601>` より新しい updated_at の行を
// tombstone(deleted_at あり)も含めて返す。since 省略時は全件。
// クライアントは返した serverTime を次回の since に使う

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const since = new URL(request.url).searchParams.get("since");
  const db = getDb();

  // serverTime は行の読み出し前に確定させる。読み出し中に入った更新は
  // 今回と次回の両方に含まれ得るが、LWW なので重複適用は無害
  const { now: serverTime } = db
    .prepare("select strftime('%Y-%m-%dT%H:%M:%fZ', 'now') as now")
    .get() as { now: string };

  const where = since ? "where updated_at > ?" : "";
  const params = since ? [since] : [];
  const trips = db
    .prepare(
      `select id, title, started_at, ended_at, transport, updated_at, deleted_at
       from trips ${where}`,
    )
    .all(...params);
  const days = db
    .prepare(
      `select id, trip_id, date, title, note, updated_at, deleted_at
       from trip_days ${where}`,
    )
    .all(...params);
  const checkpoints = db
    .prepare(
      `select id, trip_id, trip_day_id, type, name, latitude, longitude,
              planned_time, note, sort_order, updated_at, deleted_at
       from checkpoints ${where}`,
    )
    .all(...params);

  return NextResponse.json({ serverTime, trips, days, checkpoints });
}
