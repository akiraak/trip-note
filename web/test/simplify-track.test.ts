import { describe, expect, it } from "vitest";
import { simplifyTrack, TRACK_SIMPLIFY_TOLERANCE_M } from "@/lib/geo";

// 共有ページに渡すトラックの間引き(lib/geo.ts の simplifyTrack)。
// 線の形を保ったまま点を減らすこと、時間ギャップの切れ目をまたいで直線化しないことを見る

const START = Date.parse("2026-09-01T00:00:00.000Z");

// 経路は北へまっすぐ伸ばし、offsetMeters は経路と直交する東西方向へずらす
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((36 * Math.PI) / 180);

/** 1 秒間隔の点を作る。offsetMeters で経路から横に外す */
function point(index: number, offsetMeters = 0, gapAfter = 0) {
  return {
    latitude: 36 + index * 0.0001,
    longitude: 137 + offsetMeters / METERS_PER_DEGREE_LON,
    recorded_at: new Date(START + index * 1000 + gapAfter).toISOString(),
  };
}

describe("simplifyTrack", () => {
  it("2 点以下はそのまま返す", () => {
    const points = [point(0), point(1)];
    expect(simplifyTrack(points)).toEqual(points);
  });

  it("まっすぐな区間は端の 2 点まで減る", () => {
    const points = Array.from({ length: 200 }, (_, i) => point(i));
    const simplified = simplifyTrack(points);
    expect(simplified).toHaveLength(2);
    expect(simplified[0]).toBe(points[0]);
    expect(simplified[1]).toBe(points[199]);
  });

  it("許容誤差より大きく外れる点は残す", () => {
    const points = Array.from({ length: 21 }, (_, i) =>
      // 真ん中の点だけ経路から 100m 外れる
      i === 10 ? point(i, 100) : point(i),
    );
    const simplified = simplifyTrack(points);
    expect(simplified).toContain(points[10]);
    // 許容誤差(15m)より内側のずれなら落ちる
    const gentle = Array.from({ length: 21 }, (_, i) =>
      i === 10 ? point(i, TRACK_SIMPLIFY_TOLERANCE_M - 5) : point(i),
    );
    expect(simplifyTrack(gentle)).toHaveLength(2);
  });

  it("時間ギャップの切れ目は残す(区間をまたいで直線化しない)", () => {
    // 前半 10 点 → 20 分の空き → 後半 10 点(GPS 切断を挟んだ記録)
    const gap = 20 * 60 * 1000;
    const first = Array.from({ length: 10 }, (_, i) => point(i));
    const second = Array.from({ length: 10 }, (_, i) => point(i + 10, 0, gap));
    const simplified = simplifyTrack([...first, ...second]);
    // 区間ごとに端の 2 点が残るので 4 点
    expect(simplified).toHaveLength(4);
    expect(simplified[1]).toBe(first[9]);
    expect(simplified[2]).toBe(second[0]);
  });

  it("並び順は元のまま", () => {
    const points = Array.from({ length: 100 }, (_, i) =>
      i % 7 === 0 ? point(i, 60) : point(i),
    );
    const simplified = simplifyTrack(points);
    const times = simplified.map((p) => Date.parse(p.recorded_at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(simplified.length).toBeLessThan(points.length);
  });
});
