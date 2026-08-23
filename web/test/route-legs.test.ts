import { describe, expect, it } from "vitest";
import {
  buildLegs,
  legKey,
  legLines,
  totalLegMeters,
  type Leg,
  type ResolvedLeg,
} from "@/lib/route-legs";

// プランのルートをレグ(隣接チェックポイント間)として扱う純ロジック。
// iOS の Domain/RouteLegs.swift と同じ規約(キーがずれると route_legs キャッシュを共有できない)

const TOKYO = { latitude: 35.68, longitude: 139.76 };
const NAGOYA = { latitude: 35.17, longitude: 136.88 };
const MATSUMOTO = { latitude: 36.2381, longitude: 137.9719 };
const KAMIKOCHI = { latitude: 36.1451, longitude: 137.5502 };

const keys = (legs: Leg[]) => legs.map((leg) => legKey(leg.from, leg.to));

describe("legKey", () => {
  it("座標を小数 4 桁で丸めた 'lat,lon>lat,lon' を返す", () => {
    expect(legKey(MATSUMOTO, KAMIKOCHI)).toBe(
      "36.2381,137.9719>36.1451,137.5502",
    );
  });

  it("約 10m 未満(小数 5 桁目)の差は同じキーになる", () => {
    const nudged = { latitude: 36.23807, longitude: 137.97192 };
    expect(legKey(nudged, KAMIKOCHI)).toBe(legKey(MATSUMOTO, KAMIKOCHI));
  });
});

describe("buildLegs", () => {
  it("訪問順の隣接ペアをレグにする", () => {
    const legs = buildLegs({ points: [TOKYO, MATSUMOTO, KAMIKOCHI] });
    expect(legs).toEqual([
      { from: TOKYO, to: MATSUMOTO },
      { from: MATSUMOTO, to: KAMIKOCHI },
    ]);
  });

  it("start(前泊地)を先頭に差し込む", () => {
    const legs = buildLegs({ start: TOKYO, points: [MATSUMOTO] });
    expect(legs).toEqual([{ from: TOKYO, to: MATSUMOTO }]);
  });

  it("点が 1 つ以下ならレグは無い", () => {
    expect(buildLegs({ points: [] })).toEqual([]);
    expect(buildLegs({ points: [TOKYO] })).toEqual([]);
    // start があれば 1 点でも 1 レグになる
    expect(buildLegs({ start: TOKYO, points: [NAGOYA] })).toHaveLength(1);
  });

  it("丸め粒度で同一地点になる退化レグは作らない", () => {
    const nudged = { latitude: MATSUMOTO.latitude + 0.00001, longitude: MATSUMOTO.longitude };
    const legs = buildLegs({ points: [MATSUMOTO, nudged, KAMIKOCHI] });
    // 松本 → ほぼ同じ地点 は落ち、松本 → 上高地 相当の 1 レグだけが残る
    expect(keys(legs)).toEqual(["36.2381,137.9719>36.1451,137.5502"]);
  });

  it("途中挿入では変わった区間のキーだけが変わる(キャッシュが効く前提)", () => {
    const before = keys(buildLegs({ points: [TOKYO, MATSUMOTO, KAMIKOCHI] }));
    const after = keys(
      buildLegs({ points: [TOKYO, NAGOYA, MATSUMOTO, KAMIKOCHI] }),
    );
    // 東京→松本 が 東京→名古屋→松本 に割れるだけで、松本→上高地 は同じキーのまま
    expect(after).toContain(before[1]);
    expect(after).not.toContain(before[0]);
    expect(after).toHaveLength(3);
  });

  it("並び替えでも入れ替わっていない区間のキーは変わらない", () => {
    const before = keys(
      buildLegs({ points: [TOKYO, NAGOYA, MATSUMOTO, KAMIKOCHI] }),
    );
    const after = keys(
      buildLegs({ points: [TOKYO, NAGOYA, KAMIKOCHI, MATSUMOTO] }),
    );
    // 東京→名古屋 は据え置き。以降だけがキー違いになる
    expect(after[0]).toBe(before[0]);
    expect(after.slice(1)).not.toContain(before[1]);
  });
});

const resolvedLeg = (
  coordinates: [number, number][],
  distanceM: number,
): ResolvedLeg => ({ coordinates, distanceM, durationS: 3600 });

describe("totalLegMeters", () => {
  const km = (meters: number) => Math.round(meters / 1000);

  it("未解決レグは直線距離(Haversine)でフォールバックする", () => {
    // 東京 → 名古屋 の直線距離はおよそ 267km
    const legs = buildLegs({ points: [TOKYO, NAGOYA] });
    expect(km(totalLegMeters(legs, {}))).toBe(267);
  });

  it("解決済みレグは道路距離を使う", () => {
    const legs = buildLegs({ points: [TOKYO, NAGOYA] });
    const resolved = {
      [legKey(TOKYO, NAGOYA)]: resolvedLeg(
        [
          [139.76, 35.68],
          [136.88, 35.17],
        ],
        350_000,
      ),
    };
    expect(totalLegMeters(legs, resolved)).toBe(350_000);
  });

  it("解決済みと未解決が混ざっても合計できる", () => {
    const legs = buildLegs({ points: [TOKYO, NAGOYA, MATSUMOTO] });
    const resolved = {
      [legKey(TOKYO, NAGOYA)]: resolvedLeg([[139.76, 35.68]], 350_000),
    };
    // 1 本目は道路距離 350km、2 本目(名古屋→松本)は直線距離のおよそ 154km
    expect(km(totalLegMeters(legs, resolved))).toBe(504);
  });

  it("レグが無ければ 0", () => {
    expect(totalLegMeters([], {})).toBe(0);
  });
});

describe("legLines", () => {
  it("解決済みは道路形状、未解決は端点の直線を返す", () => {
    const legs = buildLegs({ points: [TOKYO, NAGOYA, MATSUMOTO] });
    const geometry: [number, number][] = [
      [139.76, 35.68],
      [138.0, 35.4],
      [136.88, 35.17],
    ];
    const lines = legLines(legs, {
      [legKey(TOKYO, NAGOYA)]: resolvedLeg(geometry, 350_000),
    });
    expect(lines).toEqual([
      geometry,
      [
        [136.88, 35.17],
        [137.9719, 36.2381],
      ],
    ]);
  });

  it("レグが無ければ空(地図には何も描かれない)", () => {
    expect(legLines([], {})).toEqual([]);
  });
});
