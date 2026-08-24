import { describe, expect, it } from "vitest";
import {
  arrivalEstimates,
  departureDateTime,
  type ArrivalCheckpoint,
} from "@/lib/arrival";
import { legKey, type ResolvedLeg, type RoutePoint } from "@/lib/route-legs";

// 到着予想の純ロジック。iOS の ArrivalEstimatorTests と同じケースを移してある
// (片方だけ規則が変わると iOS と Web で違う時刻が出てしまうため)

const start = { latitude: 36.0, longitude: 138.0 };
const p1 = { latitude: 36.1, longitude: 138.0 };
const p2 = { latitude: 36.2, longitude: 138.0 };
const p3 = { latitude: 36.3, longitude: 138.0 };

let seq = 0;
const checkpoint = (
  point: RoutePoint | null,
  plannedTime: Date | null = null,
): ArrivalCheckpoint => ({
  id: `cp-${++seq}`,
  latitude: point?.latitude ?? null,
  longitude: point?.longitude ?? null,
  planned_time: plannedTime ? plannedTime.toISOString() : null,
});

const resolved = (
  legs: [from: RoutePoint, to: RoutePoint, durationS: number][],
): Record<string, ResolvedLeg> => {
  const store: Record<string, ResolvedLeg> = {};
  for (const [from, to, durationS] of legs) {
    store[legKey(from, to)] = { coordinates: [], distanceM: 0, durationS };
  }
  return store;
};

/** anchor からの経過秒 */
const after = (date: Date, seconds: number) =>
  new Date(date.getTime() + seconds * 1000);

describe("departureDateTime", () => {
  it("日付と HH:MM をローカル TZ で合成する", () => {
    const date = departureDateTime("2026-09-01", "08:30");
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(1);
    expect(date?.getHours()).toBe(8);
    expect(date?.getMinutes()).toBe(30);
  });

  it("不正な時刻・日付は null", () => {
    expect(departureDateTime("2026-09-01", null)).toBeNull();
    expect(departureDateTime("2026-09-01", "24:00")).toBeNull();
    expect(departureDateTime("2026-09-01", "0830")).toBeNull();
    expect(departureDateTime("不正", "08:30")).toBeNull();
  });
});

describe("arrivalEstimates", () => {
  it("出発時刻からレグ所要時間を累積して予想する", () => {
    const anchor = departureDateTime("2026-09-01", "08:00")!;
    const cp1 = checkpoint(p1);
    const cp2 = checkpoint(p2);
    const estimates = arrivalEstimates({
      dayDate: "2026-09-01",
      departureTime: "08:00",
      routeStart: start,
      checkpoints: [cp1, cp2],
      resolved: resolved([
        [start, p1, 3600],
        [p1, p2, 1800],
      ]),
    });
    expect(estimates[cp1.id]).toEqual(after(anchor, 3600));
    expect(estimates[cp2.id]).toEqual(after(anchor, 5400));
  });

  it("planned_time のある CP で再アンカーしその CP 自体は予想なし", () => {
    const planned = new Date(1_000_000_000);
    const cp1 = checkpoint(p1);
    const cp2 = checkpoint(p2, planned);
    const cp3 = checkpoint(p3);
    const estimates = arrivalEstimates({
      dayDate: "2026-09-01",
      departureTime: "08:00",
      routeStart: start,
      checkpoints: [cp1, cp2, cp3],
      resolved: resolved([
        [start, p1, 3600],
        [p1, p2, 1800],
        [p2, p3, 600],
      ]),
    });
    // 手入力の予定時刻がある CP は予想を出さず、以降はそこから再連鎖する
    expect(estimates[cp2.id]).toBeUndefined();
    expect(estimates[cp3.id]).toEqual(after(planned, 600));
  });

  it("未解決レグ以降は予想なしで次の planned_time から再開する", () => {
    const planned = new Date(2_000_000_000);
    const cp1 = checkpoint(p1);
    const cp2 = checkpoint(p2);
    const cp3 = checkpoint(p3, planned);
    const cp4 = checkpoint(start);
    const estimates = arrivalEstimates({
      dayDate: "2026-09-01",
      departureTime: "08:00",
      routeStart: start,
      checkpoints: [cp1, cp2, cp3, cp4],
      // p1→p2 のレグが未解決
      resolved: resolved([
        [start, p1, 3600],
        [p3, start, 600],
      ]),
    });
    expect(estimates[cp1.id]).toBeDefined();
    expect(estimates[cp2.id]).toBeUndefined();
    expect(estimates[cp4.id]).toEqual(after(planned, 600));
  });

  it("出発時刻も手前の planned_time も無ければ予想なし", () => {
    const cp1 = checkpoint(p1);
    const cp2 = checkpoint(p2);
    const estimates = arrivalEstimates({
      dayDate: "2026-09-01",
      departureTime: null,
      routeStart: start,
      checkpoints: [cp1, cp2],
      resolved: resolved([
        [start, p1, 3600],
        [p1, p2, 1800],
      ]),
    });
    expect(estimates).toEqual({});
  });

  it("座標なし CP は予想なしでレグはそれを飛ばして連鎖する", () => {
    const anchor = departureDateTime("2026-09-01", "08:00")!;
    const cp1 = checkpoint(p1);
    const noCoords = checkpoint(null);
    const cp2 = checkpoint(p2);
    const estimates = arrivalEstimates({
      dayDate: "2026-09-01",
      departureTime: "08:00",
      routeStart: start,
      checkpoints: [cp1, noCoords, cp2],
      // レグ組み立て(buildLegs)と同様、座標なし CP を飛ばした p1→p2 のレグで繋がる
      resolved: resolved([
        [start, p1, 3600],
        [p1, p2, 1800],
      ]),
    });
    expect(estimates[noCoords.id]).toBeUndefined();
    expect(estimates[cp2.id]).toEqual(after(anchor, 5400));
  });

  it("1 日目は出発 CP の planned_time がアンカーになる", () => {
    const departureAt = new Date(3_000_000_000);
    const departure = checkpoint(start, departureAt);
    const cp1 = checkpoint(p1);
    const estimates = arrivalEstimates({
      dayDate: "2026-09-01",
      departureTime: null,
      routeStart: null,
      checkpoints: [departure, cp1],
      resolved: resolved([[start, p1, 3600]]),
    });
    expect(estimates[departure.id]).toBeUndefined();
    expect(estimates[cp1.id]).toEqual(after(departureAt, 3600));
  });

  it("丸め粒度で同じ地点のレグは所要 0 で連鎖を続ける", () => {
    const anchor = departureDateTime("2026-09-01", "08:00")!;
    const nudged = { latitude: p1.latitude + 0.00001, longitude: p1.longitude };
    const cp1 = checkpoint(p1);
    const same = checkpoint(nudged);
    const cp2 = checkpoint(p2);
    const estimates = arrivalEstimates({
      dayDate: "2026-09-01",
      departureTime: "08:00",
      routeStart: start,
      checkpoints: [cp1, same, cp2],
      resolved: resolved([
        [start, p1, 3600],
        [p1, p2, 1800],
      ]),
    });
    // 退化レグ(buildLegs でも作られない)は所要 0 扱いなので予想が途切れない
    expect(estimates[same.id]).toEqual(after(anchor, 3600));
    expect(estimates[cp2.id]).toEqual(after(anchor, 5400));
  });
});
