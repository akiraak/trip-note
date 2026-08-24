import type Database from "better-sqlite3";

// メディアと記録点の紐付け直し。
//
// 紐付けは本来 iOS の取り込み時(`Domain/MediaAttachment.swift`)に決まるが、
// 「GPS 記録を始める前に取り込んだ写真」はその時点で点が無く location_point_id が
// null のまま固定される。media は不変・一方向アップロード(`insert or ignore`)なので
// iOS が後から送り直しても反映できないため、点が届いたサーバ側で埋め直す。
// 判定ルールは iOS と揃える(片方だけ変えない)。

/** 記録範囲の外側で許す時間差の上限。iOS の `MediaAttachment.outsideTolerance` と同じ */
export const OUTSIDE_TOLERANCE_MS = 30 * 60 * 1000;

/**
 * 撮影時刻に最も近い記録時刻の位置を返す(同差なら先の点)。
 * 記録範囲(最初〜最後の点)の内側は時間差で弾かないが、
 * 範囲の外へ `tolerance` より離れた撮影は紐付けない(null)。
 */
export function nearestPointIndex(
  recordedTimes: number[],
  takenAt: number,
  tolerance = OUTSIDE_TOLERANCE_MS,
): number | null {
  let best: { index: number; interval: number } | null = null;
  let earliest = Infinity;
  let latest = -Infinity;
  for (const [index, time] of recordedTimes.entries()) {
    const interval = Math.abs(time - takenAt);
    if (best === null || interval < best.interval) best = { index, interval };
    if (time < earliest) earliest = time;
    if (time > latest) latest = time;
  }
  if (best === null) return null;
  if (takenAt < earliest - tolerance || takenAt > latest + tolerance) return null;
  return best.index;
}

/**
 * その旅行の「点が無くて位置が付かなかったメディア」を紐付け直す。紐付けた件数を返す。
 * 点が増えたときだけ結果が変わるので、`/api/sync` で points を受け取った後に呼ぶ。
 */
export function relinkTripMedia(
  db: Database.Database,
  tripId: string,
): number {
  const media = db
    .prepare(
      `select id, taken_at from media
       where trip_id = ? and location_point_id is null and deleted_at is null`,
    )
    .all(tripId) as { id: string; taken_at: string }[];
  if (media.length === 0) return 0;

  const points = db
    .prepare(
      "select id, recorded_at from location_points where trip_id = ? order by recorded_at",
    )
    .all(tripId) as { id: string; recorded_at: string }[];
  if (points.length === 0) return 0;

  const recordedTimes = points.map((point) => Date.parse(point.recorded_at));
  const update = db.prepare(
    "update media set location_point_id = ? where id = ?",
  );
  let linked = 0;
  for (const item of media) {
    const takenAt = Date.parse(item.taken_at);
    if (Number.isNaN(takenAt)) continue;
    const index = nearestPointIndex(recordedTimes, takenAt);
    if (index === null) continue;
    update.run(points[index].id, item.id);
    linked += 1;
  }
  return linked;
}
