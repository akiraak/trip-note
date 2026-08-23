import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOverpassQuery,
  fetchNearbyPlaces,
  nearbyCacheKey,
  parseOverpassElements,
  rankNearby,
  wikipediaUrl,
  type OverpassElement,
} from "@/lib/overpass";

// 実 Overpass は呼ばず global fetch をモックする(nominatim / routing と同方針)

beforeEach(() => {
  process.env.OVERPASS_MIN_INTERVAL_MS = "0";
});

afterEach(() => {
  (globalThis as unknown as { __tripnoteOverpass?: unknown }).__tripnoteOverpass =
    undefined;
  delete process.env.OVERPASS_MIN_INTERVAL_MS;
  vi.unstubAllGlobals();
});

// 宿 A(松本)→ 上高地
const route = [
  { name: "宿 A", latitude: 36.23, longitude: 137.97 },
  { name: "どこかの店", latitude: null, longitude: null },
  { name: "上高地", latitude: 36.25, longitude: 137.63 },
];

const elements: OverpassElement[] = [
  {
    type: "way" as const,
    id: 300077872,
    center: { lat: 36.2387, lon: 137.9689 },
    tags: {
      name: "松本城",
      historic: "castle",
      tourism: "museum",
      wikipedia: "ja:松本城",
      wikidata: "Q739612",
    },
  },
  {
    type: "node" as const,
    id: 1,
    lat: 36.246,
    lon: 137.636,
    tags: { name: "Kamikochi", "name:ja": "上高地", tourism: "attraction", wikidata: "Q1" },
  },
  {
    type: "node" as const,
    id: 2,
    lat: 36.234,
    lon: 137.969,
    tags: { name: "時計博物館", tourism: "museum", website: "https://example.com" },
  },
  {
    type: "node" as const,
    id: 3,
    lat: 36.2392,
    lon: 137.9678,
    tags: { name: "史蹟 松本城", historic: "memorial" },
  },
  // 名前なし・未知の種類・座標なしは落ちる
  { type: "node" as const, id: 4, lat: 36.2, lon: 137.9, tags: { tourism: "museum" } },
  { type: "node" as const, id: 5, lat: 36.2, lon: 137.9, tags: { name: "x", tourism: "hotel" } },
  { type: "way" as const, id: 6, tags: { name: "y", tourism: "museum" } },
];

describe("buildOverpassQuery", () => {
  it("経路の折れ線 around と外接矩形 + 半径の bbox、有名どころ優先の 2 段出力を組む", () => {
    const query = buildOverpassQuery("sightseeing", [
      { latitude: 36.23, longitude: 137.97 },
      { latitude: 36.25, longitude: 137.63 },
    ]);
    const bbox = /^\[out:json\]\[timeout:25\]\[bbox:([\d.,-]+)\];/.exec(query);
    const [south, west, north, east] = bbox![1].split(",").map(Number);
    // 外接矩形(36.23〜36.25 / 137.63〜137.97)を 15km(緯度 0.135° / 経度 0.167°)広げる
    expect(south).toBeCloseTo(36.0953, 3);
    expect(west).toBeCloseTo(137.4629, 3);
    expect(north).toBeCloseTo(36.3847, 3);
    expect(east).toBeCloseTo(138.1371, 3);
    expect(query).toContain("(around:15000,36.2300,137.9700,36.2500,137.6300)");
    expect(query).toContain(`nwr["historic"~"^(castle|monument|memorial|ruins|archaeological_site)$"]["name"]`);
    // 寺社・温泉は wikipedia 付きのみ
    expect(query).toContain(`nwr["amenity"="place_of_worship"]["wikipedia"]["name"]`);
    expect(query).toContain(".notable out center tags 100;");
    expect(query).toContain(".rest out center tags 60;");
  });

  it("座標が無ければ例外", () => {
    expect(() => buildOverpassQuery("sightseeing", [])).toThrow(/座標/);
  });
});

describe("wikipediaUrl", () => {
  it("言語プレフィックス付きタグを URL にする(無ければ en、空は null)", () => {
    expect(wikipediaUrl("ja:松本城")).toBe(
      "https://ja.wikipedia.org/wiki/%E6%9D%BE%E6%9C%AC%E5%9F%8E",
    );
    expect(wikipediaUrl("Matsumoto Castle")).toBe(
      "https://en.wikipedia.org/wiki/Matsumoto_Castle",
    );
    expect(wikipediaUrl(undefined)).toBeNull();
    expect(wikipediaUrl("ja:")).toBeNull();
  });
});

describe("parseOverpassElements", () => {
  it("node は lat/lon、way は center。name:ja 優先、種類は historic を先に見る", () => {
    const parsed = parseOverpassElements(elements);
    expect(parsed.map((p) => p.name)).toEqual(["松本城", "上高地", "時計博物館", "史蹟 松本城"]);
    expect(parsed[0]).toMatchObject({
      id: "way/300077872",
      kind: "castle",
      kindLabel: "城",
      latitude: 36.2387,
      longitude: 137.9689,
      wikipediaUrl: "https://ja.wikipedia.org/wiki/%E6%9D%BE%E6%9C%AC%E5%9F%8E",
      notable: true,
    });
    expect(parsed[1]).toMatchObject({ kindLabel: "観光スポット", notable: true, wikipediaUrl: null });
    expect(parsed[2]).toMatchObject({ website: "https://example.com", notable: false });
  });
});

describe("rankNearby", () => {
  it("有名どころ → 種類の重み → 経路から近い順。最寄り地点名と距離を付ける", () => {
    const ranked = rankNearby(parseOverpassElements(elements), route);
    // 上高地と松本城は同点(有名どころ + 重み 3)なので経路に近い上高地(約 700m)が先
    expect(ranked.map((p) => p.name)).toEqual(["上高地", "松本城", "時計博物館", "史蹟 松本城"]);
    expect(ranked[0].nearestRouteName).toBe("上高地");
    expect(ranked[1].nearestRouteName).toBe("宿 A");
    expect(ranked[1].distanceM).toBeGreaterThan(900);
    expect(ranked[1].distanceM).toBeLessThan(1100);
  });

  it("同じ有名度・種類なら距離順で、上限を超えた分は捨てる", () => {
    const far = { ...elements[2], id: 20, lat: 36.3, lon: 137.8, tags: { name: "遠い博物館", tourism: "museum" } };
    const near = { ...elements[2], id: 21, tags: { name: "近い博物館", tourism: "museum" } };
    const ranked = rankNearby(parseOverpassElements([far, near]), route, 1);
    expect(ranked.map((p) => p.name)).toEqual(["近い博物館"]);
  });
});

describe("fetchNearbyPlaces", () => {
  function overpassOk(body: unknown) {
    return { ok: true, status: 200, json: async () => body };
  }

  it("POST で data を送り、結果を並べて返す。同じ経路(100m 粒度)は再送しない", async () => {
    const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<unknown>>(
      async () => overpassOk({ elements }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const places = await fetchNearbyPlaces("sightseeing", route);
    expect(places.map((p) => p.name)).toEqual(["上高地", "松本城", "時計博物館", "史蹟 松本城"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://overpass-api.de/api/interpreter");
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("data=%5Bout%3Ajson%5D");

    const nudged = route.map((p) =>
      p.latitude === null ? p : { ...p, latitude: p.latitude + 0.0001 },
    );
    await fetchNearbyPlaces("sightseeing", nudged);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nearbyCacheKey("sightseeing", route)).toBe("sightseeing|36.230,137.970;36.250,137.630");
  });

  it("remark のエラー(タイムアウト)は例外にし、キャッシュしない", async () => {
    const fetchMock = vi.fn(async () =>
      overpassOk({ elements: [], remark: "runtime error: Query timed out" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchNearbyPlaces("sightseeing", route)).rejects.toThrow(/timed out/);
    await expect(fetchNearbyPlaces("sightseeing", route)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("経路に座標が無ければ fetch せずに例外", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchNearbyPlaces("sightseeing", [{ name: "x", latitude: null, longitude: null }]),
    ).rejects.toThrow(/座標/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
