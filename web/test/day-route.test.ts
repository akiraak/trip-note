import { describe, expect, it } from "vitest";
import {
  dayRoute,
  isViewbox,
  routeAnchor,
  searchViewbox,
} from "@/lib/day-route";

// 3 日のプラン。1 日目: 松本城 → 宿 A(座標あり)、2 日目: 座標なし CP のみ、3 日目: 上高地
const days = [
  {
    checkpoints: [
      { name: "松本城", latitude: 36.2381, longitude: 137.969 },
      { name: "宿 A", latitude: 36.23, longitude: 137.97 },
    ],
  },
  { checkpoints: [{ name: "どこかのカフェ", latitude: null, longitude: null }] },
  { checkpoints: [{ name: "上高地", latitude: 36.25, longitude: 137.63 }] },
];

describe("routeAnchor / dayRoute", () => {
  it("前泊地は前日の最後の座標あり CP。無ければさらに遡る", () => {
    expect(routeAnchor(days, 1)?.name).toBe("宿 A");
    expect(routeAnchor(days, 2)?.name).toBe("宿 A");
    expect(routeAnchor(days, 0)).toBeNull();
  });

  it("経路は前泊地 + 訪問順 CP で、座標なしも名前だけ含む", () => {
    expect(dayRoute(days, 1)).toEqual([
      { name: "宿 A", latitude: 36.23, longitude: 137.97 },
      { name: "どこかのカフェ", latitude: null, longitude: null },
    ]);
    expect(dayRoute(days, 0).map((p) => p.name)).toEqual(["松本城", "宿 A"]);
    expect(dayRoute(days, 9)).toEqual([]);
  });
});

describe("searchViewbox", () => {
  it("座標が無ければ null", () => {
    expect(searchViewbox([])).toBeNull();
    expect(
      searchViewbox([{ name: "x", latitude: null, longitude: null }]),
    ).toBeNull();
  });

  it("近接した経路でも最低 0.18°(約 20km)四方を確保する", () => {
    const box = searchViewbox(dayRoute(days, 0))!;
    const [minLon, minLat, maxLon, maxLat] = box;
    expect(maxLat - minLat).toBeCloseTo(0.18, 3);
    // 経度は cos(緯度) で伸びる
    expect(maxLon - minLon).toBeGreaterThan(0.18);
    expect((minLat + maxLat) / 2).toBeCloseTo(36.23405, 3);
    expect((minLon + maxLon) / 2).toBeCloseTo(137.9695, 3);
  });

  it("長い経路は外接矩形に 1.5 倍の余白を掛ける", () => {
    const box = searchViewbox([
      { name: "宿 A", latitude: 36.23, longitude: 137.97 },
      { name: "上高地", latitude: 36.25, longitude: 137.63 },
    ])!;
    const [minLon, , maxLon] = box;
    expect(maxLon - minLon).toBeCloseTo(0.34 * 1.5, 3);
  });
});

describe("isViewbox", () => {
  it("有限数 4 つの配列だけ受け付ける", () => {
    expect(isViewbox([1, 2, 3, 4])).toBe(true);
    expect(isViewbox([1, 2, 3])).toBe(false);
    expect(isViewbox([1, 2, 3, "4"])).toBe(false);
    expect(isViewbox(null)).toBe(false);
  });
});
