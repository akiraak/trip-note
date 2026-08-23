import { describe, expect, it } from "vitest";
import { dayDistanceMeters, dayMapPoints } from "@/lib/plan-map";
import type { CheckpointType } from "@/lib/types";

// 日別プラン地図のデータ組み立て(iOS の DayRoute.anchor と同じ規則)

let seq = 0;
const cp = (
  over: Partial<{
    id: string;
    type: CheckpointType;
    name: string;
    latitude: number | null;
    longitude: number | null;
  }> = {},
) => ({
  id: `cp-${++seq}`,
  type: "sightseeing" as CheckpointType,
  name: "どこか",
  latitude: 36.23,
  longitude: 137.97,
  ...over,
});

describe("dayMapPoints", () => {
  it("日内の順序を保ったまま座標ありだけを返す", () => {
    const [day] = dayMapPoints([
      {
        checkpoints: [
          cp({ id: "a", name: "松本城", latitude: 36.23, longitude: 137.97 }),
          cp({ id: "b", name: "地域だけ決まった宿", latitude: null, longitude: null }),
          cp({ id: "c", name: "上高地", latitude: 36.25, longitude: 137.63 }),
        ],
      },
    ]);
    expect(day.points.map((p) => p.id)).toEqual(["a", "c"]);
    expect(day.points[0]).toEqual({
      id: "a",
      type: "sightseeing",
      name: "松本城",
      latitude: 36.23,
      longitude: 137.97,
    });
    expect(day.anchor).toBeNull();
  });

  it("片方だけの座標は捨てる", () => {
    const [day] = dayMapPoints([
      {
        checkpoints: [
          cp({ id: "a", latitude: 36.25, longitude: null }),
          cp({ id: "b", latitude: null, longitude: 137.63 }),
          cp({ id: "c" }),
        ],
      },
    ]);
    expect(day.points.map((p) => p.id)).toEqual(["c"]);
  });

  it("起点は前日の最後の座標ありチェックポイント(= 前泊地)", () => {
    const days = dayMapPoints([
      {
        checkpoints: [
          cp({ id: "d1-1", latitude: 35.68, longitude: 139.76 }),
          cp({ id: "d1-2", type: "lodging", latitude: 36.23, longitude: 137.97 }),
        ],
      },
      { checkpoints: [cp({ id: "d2-1", latitude: 36.25, longitude: 137.63 })] },
    ]);
    expect(days[0].anchor).toBeNull();
    expect(days[1].anchor).toEqual({ latitude: 36.23, longitude: 137.97 });
  });

  it("直前の日に座標が無ければ数日前まで遡る", () => {
    const days = dayMapPoints([
      { checkpoints: [cp({ id: "d1", latitude: 36.23, longitude: 137.97 })] },
      // 予定だけ書いて場所が未定の日、予定そのものが無い日を挟む
      { checkpoints: [cp({ latitude: null, longitude: null })] },
      { checkpoints: [] },
      { checkpoints: [cp({ id: "d4", latitude: 36.25, longitude: 137.63 })] },
    ]);
    expect(days[3].anchor).toEqual({ latitude: 36.23, longitude: 137.97 });
    // 座標ありが 0 件の日も要素は返す(呼び出し側で地図を出さない)
    expect(days[1].points).toEqual([]);
    expect(days[2].points).toEqual([]);
  });

  it("前の日すべてに座標が無ければ起点は null", () => {
    const days = dayMapPoints([
      { checkpoints: [cp({ latitude: null, longitude: null })] },
      { checkpoints: [cp({ id: "d2", latitude: 36.25, longitude: 137.63 })] },
    ]);
    expect(days[1].anchor).toBeNull();
  });

  it("days と同じ件数・順序で返す", () => {
    expect(dayMapPoints([])).toEqual([]);
    expect(dayMapPoints([{ checkpoints: [] }, { checkpoints: [] }])).toEqual([
      { points: [], anchor: null },
      { points: [], anchor: null },
    ]);
  });
});

// その日の移動距離。iOS がレグ未解決のときに出すのと同じ直線距離ベースの概算
describe("dayDistanceMeters", () => {
  const km = (meters: number) => Math.round(meters / 1000);

  it("訪問順のチェックポイントを直線で結んだ距離を返す", () => {
    // 東京(35.68,139.76) → 名古屋(35.17,136.88) の直線距離はおよそ 267km
    const [day] = dayMapPoints([
      {
        checkpoints: [
          cp({ latitude: 35.68, longitude: 139.76 }),
          cp({ latitude: 35.17, longitude: 136.88 }),
        ],
      },
    ]);
    expect(km(dayDistanceMeters(day))).toBe(267);
  });

  it("前泊地(anchor)を起点に含める", () => {
    const days = dayMapPoints([
      { checkpoints: [cp({ latitude: 35.68, longitude: 139.76 })] },
      { checkpoints: [cp({ latitude: 35.17, longitude: 136.88 })] },
    ]);
    // 2 日目は前泊地(東京)からの 1 レグぶん
    expect(km(dayDistanceMeters(days[1]))).toBe(267);
    // 1 日目は点が 1 つだけで起点も無いのでレグが無い
    expect(dayDistanceMeters(days[0])).toBe(0);
  });

  it("座標なしのチェックポイントは距離に効かない", () => {
    const [day] = dayMapPoints([
      {
        checkpoints: [
          cp({ latitude: 35.68, longitude: 139.76 }),
          cp({ latitude: null, longitude: null }),
          cp({ latitude: 35.17, longitude: 136.88 }),
        ],
      },
    ]);
    expect(km(dayDistanceMeters(day))).toBe(267);
  });

  it("チェックポイントが無い日は 0", () => {
    const [day] = dayMapPoints([{ checkpoints: [] }]);
    expect(dayDistanceMeters(day)).toBe(0);
  });
});
