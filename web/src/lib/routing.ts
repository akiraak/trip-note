import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { getDb } from "./db";
import { legKey, type ResolvedLeg } from "./route-legs";

// 欧州の OSRM / Nominatim への TCP 接続は RTT が Node 既定の happy-eyeballs
// 試行タイムアウト(250ms)を超えることがあり、fetch が ETIMEDOUT
// (AggregateError)で落ちる(g3plus で実測)。プロセス全体で余裕を持たせる
setDefaultAutoSelectFamilyAttemptTimeout(2500);

// OSRM の道路ルーティングをサーバ経由でプロキシし、レグ(隣接チェックポイント間)
// 単位で route_legs テーブルにキャッシュする。デモサーバ利用の作法は nominatim.ts と同じ:
//   - アプリを特定できる User-Agent を送る
//   - リクエストは直列化して間隔を空ける(最大 1 req/s)
//   - 結果をキャッシュして再送を避ける(道路形状は滅多に変わらないので無期限)
// 単一ユーザー・単一プロセス運用なのでプロセス内での制御で足りる

export type LatLng = { latitude: number; longitude: number };

/** 解決済みレグ(lib/route-legs.ts の ResolvedLeg と同じ形。/api/route の応答もこれ) */
export type RouteLeg = ResolvedLeg;

// キー規約は lib/route-legs.ts が正本(クライアントからも使うため)。
// 既存の import 元を変えずに済むようここから再エクスポートする
export { legKey };

const DEFAULT_ENDPOINT = "https://router.project-osrm.org";
const USER_AGENT = "trip-note/0.1 (https://trip.chobi.me)";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MAX_ROWS = 5000;

function endpoint(): string {
  return process.env.OSRM_ENDPOINT || DEFAULT_ENDPOINT;
}

// テストからの上書き用に遅延評価にしている(通常は未設定 = 1 秒)
function minIntervalMs(): number {
  const value = Number(process.env.OSRM_MIN_INTERVAL_MS);
  return Number.isFinite(value) && value >= 0 ? value : 1000;
}

type RoutingState = {
  queue: Promise<unknown>;
  lastFetchAt: number;
};

// dev サーバの HMR で状態が消えてもレート制限が壊れないよう globalThis に置く
const globalCache = globalThis as unknown as {
  __tripnoteRouting?: RoutingState;
};

function state(): RoutingState {
  if (!globalCache.__tripnoteRouting) {
    globalCache.__tripnoteRouting = { queue: Promise.resolve(), lastFetchAt: 0 };
  }
  return globalCache.__tripnoteRouting;
}

// リクエストを直列化し、実行間隔を minIntervalMs 以上空ける
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const s = state();
  const run = async () => {
    const wait = s.lastFetchAt + minIntervalMs() - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    s.lastFetchAt = Date.now();
    return task();
  };
  const result = s.queue.then(run, run);
  s.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export const MAX_LEGS_PER_REQUEST = 50;

function parseLatLng(value: unknown): LatLng | null {
  if (typeof value !== "object" || value === null) return null;
  const { latitude, longitude } = value as Record<string, unknown>;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/// POST /api/route のリクエストボディを検証する。不正なら null
export function parseRouteLegsBody(
  body: unknown,
): { from: LatLng; to: LatLng }[] | null {
  if (typeof body !== "object" || body === null) return null;
  const { legs } = body as Record<string, unknown>;
  if (
    !Array.isArray(legs) ||
    legs.length === 0 ||
    legs.length > MAX_LEGS_PER_REQUEST
  ) {
    return null;
  }
  const parsed: { from: LatLng; to: LatLng }[] = [];
  for (const leg of legs) {
    if (typeof leg !== "object" || leg === null) return null;
    const from = parseLatLng((leg as Record<string, unknown>).from);
    const to = parseLatLng((leg as Record<string, unknown>).to);
    if (!from || !to) return null;
    parsed.push({ from, to });
  }
  return parsed;
}

type OsrmResponse = {
  code: string;
  routes?: {
    geometry: { coordinates: [number, number][] };
    distance: number;
    duration: number;
  }[];
};

async function fetchFromOsrm(from: LatLng, to: LatLng): Promise<RouteLeg | null> {
  const path = `/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const url = new URL(path, endpoint());
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    console.error(`[routing] OSRM HTTP ${response.status} for ${url.pathname}`);
    return null;
  }
  const body = (await response.json()) as OsrmResponse;
  const route = body.routes?.[0];
  if (body.code !== "Ok" || !route) {
    console.error(`[routing] OSRM code=${body.code} for ${url.pathname}`);
    return null;
  }
  return {
    coordinates: route.geometry.coordinates,
    distanceM: route.distance,
    durationS: route.duration,
  };
}

type RouteLegRow = { geometry: string; distance_m: number; duration_s: number };

function readCached(key: string): RouteLeg | null {
  const row = getDb()
    .prepare<[string], RouteLegRow>(
      "select geometry, distance_m, duration_s from route_legs where key = ?",
    )
    .get(key);
  if (!row) return null;
  return {
    coordinates: JSON.parse(row.geometry) as [number, number][],
    distanceM: row.distance_m,
    durationS: row.duration_s,
  };
}

/// キャッシュ済みのレグだけをまとめて読む(**OSRM は呼ばない**)。
/// SSR で初期表示ぶんを渡し、2 回目以降(および iOS で先に見た旅行)は
/// 最初の描画から道路形状で描くために使う。未キャッシュのキーは結果に含まれない
export function readCachedLegs(keys: string[]): Record<string, RouteLeg> {
  const unique = [...new Set(keys)];
  const found: Record<string, RouteLeg> = {};
  const db = getDb();
  // SQLite のバインド変数上限に掛からないよう分割して引く
  const chunkSize = 500;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const rows = db
      .prepare<string[], RouteLegRow & { key: string }>(
        `select key, geometry, distance_m, duration_s from route_legs
         where key in (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk);
    for (const row of rows) {
      found[row.key] = {
        coordinates: JSON.parse(row.geometry) as [number, number][],
        distanceM: row.distance_m,
        durationS: row.duration_s,
      };
    }
  }
  return found;
}

function saveCached(key: string, leg: RouteLeg) {
  const db = getDb();
  db.prepare(
    `insert into route_legs (key, geometry, distance_m, duration_s) values (?, ?, ?, ?)
     on conflict (key) do update set
       geometry = excluded.geometry,
       distance_m = excluded.distance_m,
       duration_s = excluded.duration_s,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(key, JSON.stringify(leg.coordinates), leg.distanceM, leg.durationS);
  // 肥大化対策: 上限を超えた分を古い順に削除する
  db.prepare(
    `delete from route_legs where key not in
       (select key from route_legs order by created_at desc, rowid desc limit ?)`,
  ).run(CACHE_MAX_ROWS);
}

/// レグ列を入力と同順・同数で解決する。キャッシュミスだけ OSRM を呼び、
/// 解決できないレグ(OSRM 停止・ルート無し等)は null(呼び出し側で直線フォールバック)。
/// 失敗はキャッシュしないので次回のリクエストで再試行される
export async function fetchRouteLegs(
  legs: { from: LatLng; to: LatLng }[],
): Promise<(RouteLeg | null)[]> {
  // 同一キーの重複リクエストをまとめる(1 回だけ取得して全員に配る)
  const pending = new Map<string, Promise<RouteLeg | null>>();
  return Promise.all(
    legs.map((leg) => {
      const key = legKey(leg.from, leg.to);
      const cached = readCached(key);
      if (cached) return Promise.resolve(cached);
      let promise = pending.get(key);
      if (!promise) {
        promise = throttled(() => fetchFromOsrm(leg.from, leg.to))
          .then((fetched) => {
            if (fetched) saveCached(key, fetched);
            return fetched;
          })
          .catch((error) => {
            // 失敗レグは null(クライアントは直線フォールバック)。原因調査用にログだけ残す
            console.error(`[routing] leg ${key} failed:`, error);
            return null;
          });
        pending.set(key, promise);
      }
      return promise;
    }),
  );
}
