import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  fetchRouteLegs,
  legKey,
  parseRouteLegsBody,
  readCachedLegs,
} from "@/lib/routing";

// OSRM プロキシ + レグキャッシュ(lib/routing.ts)を検証する。
// 実 OSRM は呼ばず global fetch をモックする(nominatim と同方針の構成)

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-note-test-"));
  process.env.TRIPNOTE_DB_PATH = path.join(tempDir, "test.db");
  // テストではスロットルの待ち時間を無くす
  process.env.OSRM_MIN_INTERVAL_MS = "0";
});

afterEach(() => {
  const cache = globalThis as unknown as {
    __tripnoteDb?: Database.Database;
    __tripnoteRouting?: unknown;
  };
  cache.__tripnoteDb?.close();
  cache.__tripnoteDb = undefined;
  cache.__tripnoteRouting = undefined;
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.OSRM_MIN_INTERVAL_MS;
  vi.unstubAllGlobals();
});

const FROM = { latitude: 36.2381, longitude: 137.9719 }; // 松本駅
const TO = { latitude: 36.1451, longitude: 137.5502 }; // 上高地

function osrmOk(coordinates: [number, number][]) {
  return {
    ok: true,
    json: async () => ({
      code: "Ok",
      routes: [
        { geometry: { coordinates }, distance: 1234.5, duration: 678.9 },
      ],
    }),
  };
}

describe("legKey", () => {
  it("座標を小数 4 桁で丸めた 'lat,lon>lat,lon' を返す", () => {
    expect(legKey(FROM, TO)).toBe("36.2381,137.9719>36.1451,137.5502");
  });

  it("約 10m 未満(小数 5 桁目)の差は同じキーになる", () => {
    const nudged = { latitude: 36.23807, longitude: 137.97192 };
    expect(legKey(nudged, TO)).toBe(legKey(FROM, TO));
  });
});

describe("fetchRouteLegs", () => {
  it("キャッシュミスは OSRM を呼び、2 回目はキャッシュから返す", async () => {
    const geometry: [number, number][] = [
      [137.9719, 36.2381],
      [137.7, 36.2],
      [137.5502, 36.1451],
    ];
    const fetchMock = vi.fn().mockResolvedValue(osrmOk(geometry));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchRouteLegs([{ from: FROM, to: TO }]);
    expect(first).toEqual([
      { coordinates: geometry, distanceM: 1234.5, durationS: 678.9 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(
      "/route/v1/driving/137.9719,36.2381;137.5502,36.1451",
    );
    expect(url).toContain("overview=full");
    expect(url).toContain("geometries=geojson");

    const second = await fetchRouteLegs([{ from: FROM, to: TO }]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("同一リクエスト内の同一キーのレグは 1 回だけ取得する(丸め粒度で判定)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(osrmOk([[137.9, 36.2]]));
    vi.stubGlobal("fetch", fetchMock);

    const nudged = { latitude: FROM.latitude + 0.00001, longitude: FROM.longitude };
    const legs = await fetchRouteLegs([
      { from: FROM, to: TO },
      { from: nudged, to: TO },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(legs[0]).toEqual(legs[1]);
  });

  it("OSRM がルート無しを返したレグは null になり、キャッシュしない(次回再試行)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: "NoRoute", routes: [] }),
      })
      .mockResolvedValueOnce(osrmOk([[137.9, 36.2]]));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchRouteLegs([{ from: FROM, to: TO }])).toEqual([null]);
    expect(
      getDb().prepare("select count(*) as n from route_legs").get(),
    ).toEqual({ n: 0 });

    // 失敗はキャッシュされないので同じレグで再び OSRM を呼ぶ
    const retried = await fetchRouteLegs([{ from: FROM, to: TO }]);
    expect(retried[0]).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetch 例外・HTTP エラーも null(他レグの解決は継続する)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce(osrmOk([[137.9, 36.2]]));
    vi.stubGlobal("fetch", fetchMock);

    const legs = await fetchRouteLegs([
      { from: FROM, to: TO },
      { from: TO, to: FROM },
      { from: FROM, to: { latitude: 35.681, longitude: 139.767 } },
    ]);
    expect(legs[0]).toBeNull();
    expect(legs[1]).toBeNull();
    expect(legs[2]).not.toBeNull();
  });

  it("キャッシュが上限を超えたら古い順に削除する", async () => {
    const insert = getDb().prepare(
      `insert into route_legs (key, geometry, distance_m, duration_s, created_at, updated_at)
       values (?, '[]', 0, 0, ?, ?)`,
    );
    for (let i = 0; i < 5000; i++) {
      const at = `2000-01-01T00:00:00.${String(i % 1000).padStart(3, "0")}Z`;
      insert.run(`old-${String(i).padStart(4, "0")}`, at, at);
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(osrmOk([[137.9, 36.2]])));

    await fetchRouteLegs([{ from: FROM, to: TO }]);

    const db = getDb();
    expect(db.prepare("select count(*) as n from route_legs").get()).toEqual({
      n: 5000,
    });
    // 新しいレグは残り、最古の行が捨てられている
    const newKey = legKey(FROM, TO);
    expect(
      db.prepare("select count(*) as n from route_legs where key = ?").get(newKey),
    ).toEqual({ n: 1 });
    expect(
      db
        .prepare("select count(*) as n from route_legs where key = 'old-0000'")
        .get(),
    ).toEqual({ n: 0 });
  });
});

// SSR のプリフィル用。キャッシュ済みのレグだけを返し OSRM は呼ばない
describe("readCachedLegs", () => {
  it("キャッシュ済みのキーだけを返す(未キャッシュは含めない)", async () => {
    const geometry: [number, number][] = [
      [137.9719, 36.2381],
      [137.5502, 36.1451],
    ];
    const fetchMock = vi.fn().mockResolvedValue(osrmOk(geometry));
    vi.stubGlobal("fetch", fetchMock);
    await fetchRouteLegs([{ from: FROM, to: TO }]);

    const cached = readCachedLegs([legKey(FROM, TO), legKey(TO, FROM)]);
    expect(cached).toEqual({
      [legKey(FROM, TO)]: {
        coordinates: geometry,
        distanceM: 1234.5,
        durationS: 678.9,
      },
    });
    // 未キャッシュのレグを聞かれても OSRM は呼ばない
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("キーが空・全部未キャッシュなら空を返す", () => {
    expect(readCachedLegs([])).toEqual({});
    expect(readCachedLegs([legKey(FROM, TO)])).toEqual({});
  });
});

describe("parseRouteLegsBody", () => {
  const leg = (from = FROM, to = TO) => ({ from, to });

  it("正しい入力を受け付ける", () => {
    expect(parseRouteLegsBody({ legs: [leg()] })).toEqual([
      { from: FROM, to: TO },
    ]);
  });

  it("legs 欠落・空配列・上限超えは null", () => {
    expect(parseRouteLegsBody({})).toBeNull();
    expect(parseRouteLegsBody({ legs: [] })).toBeNull();
    expect(parseRouteLegsBody({ legs: Array(51).fill(leg()) })).toBeNull();
  });

  it("座標の型・範囲を検証する", () => {
    expect(
      parseRouteLegsBody({ legs: [leg({ latitude: 91, longitude: 0 })] }),
    ).toBeNull();
    expect(
      parseRouteLegsBody({ legs: [leg({ latitude: 0, longitude: 181 })] }),
    ).toBeNull();
    expect(
      parseRouteLegsBody({
        legs: [leg({ latitude: Number.NaN, longitude: 0 })],
      }),
    ).toBeNull();
    expect(
      parseRouteLegsBody({
        legs: [{ from: { latitude: "36", longitude: 137 }, to: TO }],
      }),
    ).toBeNull();
    expect(parseRouteLegsBody({ legs: [{ from: FROM }] })).toBeNull();
  });
});
