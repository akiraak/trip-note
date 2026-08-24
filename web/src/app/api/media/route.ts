import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/auth";
import { getDb, getMediaDir } from "@/lib/db";
import { deleteMedia, isDeleted } from "@/lib/media";

// iOS アプリからのメディアアップロード。メタデータはクエリ、ボディはファイルバイナリ。
// 行は immutable なので insert or ignore、ファイルは上書きで再送は冪等
// (仕様: docs/specs/phase4-media.md)

// Cloudflare Tunnel 経由の上限(100MB)より大きめの、明らかな異常値だけ弾くガード
const MAX_BYTES = 200 * 1024 * 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_TYPES = ["photo", "video"];
const EXTENSIONS = ["jpg", "mp4", "mov"];

/// 任意の座標クエリ。未指定は null、範囲外・数値でない場合は undefined(= 400)
function parseCoordinate(value: string | null, limit: number) {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return undefined;
  return parsed;
}

export async function POST(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams;
  const id = query.get("id") ?? "";
  const tripId = query.get("trip_id") ?? "";
  const locationPointId = query.get("location_point_id");
  const type = query.get("type") ?? "";
  const takenAt = query.get("taken_at") ?? "";
  const ext = query.get("ext") ?? "";
  // メディア自身の撮影位置(EXIF GPS / 動画メタデータ)。無い写真も多いため任意
  const latitude = parseCoordinate(query.get("latitude"), 90);
  const longitude = parseCoordinate(query.get("longitude"), 180);
  if (
    !UUID_RE.test(id) ||
    !UUID_RE.test(tripId) ||
    (locationPointId !== null && !UUID_RE.test(locationPointId)) ||
    !MEDIA_TYPES.includes(type) ||
    !EXTENSIONS.includes(ext) ||
    Number.isNaN(Date.parse(takenAt)) ||
    latitude === undefined ||
    longitude === undefined ||
    // 片方だけでは地図に出せない
    (latitude === null) !== (longitude === null)
  ) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }
  if (body.length > MAX_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }

  const db = getDb();
  // trip は同期順(trips → points → media)で先に届いているはず。無ければ次回再送
  if (!db.prepare("select 1 from trips where id = ?").get(tripId)) {
    return NextResponse.json({ error: "unknown trip" }, { status: 409 });
  }
  // Web から削除済みのメディアはファイルを復活させない。クライアントには成功を返し、
  // 次の pull で tombstone を受け取ってローカルからも消してもらう
  if (isDeleted(id)) {
    return NextResponse.json({ ok: true, deleted: true });
  }
  // 点が未同期の場合は null で保存する(points の skip と同じ寛容方針)
  const pointId =
    locationPointId &&
    db.prepare("select 1 from location_points where id = ?").get(locationPointId)
      ? locationPointId
      : null;

  // UUID + 拡張子ホワイトリスト検証済みのためパストラバーサルの余地はない。
  // 保存先は実行時にしか決まらないため Turbopack のファイルトレースから除外する
  const storagePath = `${id}.${ext}`;
  const finalPath = path.join(/*turbopackIgnore: true*/ getMediaDir(), storagePath);
  const tmpPath = `${finalPath}.tmp`;
  fs.writeFileSync(tmpPath, body);
  fs.renameSync(tmpPath, finalPath);

  db.prepare(
    `insert or ignore into media
       (id, trip_id, location_point_id, type, storage_path, taken_at, latitude, longitude)
     values (@id, @trip_id, @location_point_id, @type, @storage_path, @taken_at,
             @latitude, @longitude)`,
  ).run({
    id,
    trip_id: tripId,
    location_point_id: pointId,
    type,
    storage_path: storagePath,
    taken_at: takenAt,
    latitude,
    longitude,
  });

  return NextResponse.json({ ok: true });
}

// iOS でメディアを削除したときの伝搬。ファイルは物理削除、行は tombstone
// (Web からの削除と同じ `lib/media.ts` の処理)。
// クライアントは 404 も成功扱いにするため再送は冪等
export async function DELETE(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }
  if (!deleteMedia(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
