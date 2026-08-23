import { describe, expect, it } from "vitest";
import { outlineMapPoints, type OutlineMapNight } from "@/lib/outline-map";

// 候補プレビュー地図の点列(iOS の TripCreateView.mapPoints と同じ順序・規則)

const night = (over: Partial<OutlineMapNight> = {}): OutlineMapNight => ({
  area: "松本市街",
  name: "松本駅前の宿",
  latitude: 36.23,
  longitude: 137.97,
  ...over,
});

const departure = { name: "自宅", latitude: 35.68, longitude: 139.76 };
const destination = { name: "上高地", latitude: 36.25, longitude: 137.63 };

describe("outlineMapPoints", () => {
  it("出発地 → 各泊 → 目的地の順に並べる", () => {
    const points = outlineMapPoints({
      departure,
      nights: [night(), night({ area: "上高地", latitude: 36.25, longitude: 137.63 })],
      destination,
    });
    expect(points.map((p) => [p.type, p.label])).toEqual([
      ["departure", "自宅"],
      ["lodging", "1泊目 松本市街"],
      ["lodging", "2泊目 上高地"],
      ["destination", "上高地"],
    ]);
    expect(points[0]).toMatchObject({ latitude: 35.68, longitude: 139.76 });
  });

  it("座標が無い点は飛ばす(片方だけの座標も捨てる)", () => {
    const points = outlineMapPoints({
      // 手入力の出発地は座標が無い
      departure: { name: "自宅", latitude: null, longitude: null },
      nights: [
        night({ latitude: null, longitude: null }),
        night({ area: "上高地", latitude: 36.25, longitude: null }),
        night({ area: "白骨温泉", latitude: 36.18, longitude: 137.65 }),
      ],
      destination,
    });
    expect(points.map((p) => p.label)).toEqual(["3泊目 白骨温泉", "上高地"]);
  });

  it("出発地・目的地が無ければ泊だけになる", () => {
    const points = outlineMapPoints({
      departure: null,
      nights: [night()],
      destination: null,
    });
    expect(points.map((p) => p.type)).toEqual(["lodging"]);
  });

  it("名前が空なら既定のラベルにし、泊は地域が空なら宿名を使う", () => {
    const points = outlineMapPoints({
      departure: { name: "  ", latitude: 35.68, longitude: 139.76 },
      nights: [night({ area: "  " })],
      destination: { name: null, latitude: 36.25, longitude: 137.63 },
    });
    expect(points.map((p) => p.label)).toEqual([
      "出発",
      "1泊目 松本駅前の宿",
      "目的地",
    ]);
  });

  it("泊が無く座標も無ければ空になる", () => {
    expect(
      outlineMapPoints({ departure: null, nights: [], destination: null }),
    ).toEqual([]);
  });
});
