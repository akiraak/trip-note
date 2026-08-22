import type { Viewbox } from "./day-route";
import type { CheckpointType } from "./types";

// Nominatim (OSM) の地点検索をサーバ経由でプロキシする。
// 利用規約 (https://operations.osmfoundation.org/policies/nominatim/) に従い、
//   - アプリを特定できる User-Agent を送る
//   - リクエストは最大 1 req/s(プロセス内で直列化して間隔を空ける)
//   - 同一クエリの結果をキャッシュして再送を避ける
// 単一ユーザー・単一プロセス運用なのでプロセス内での制御で足りる

export type Place = {
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  /** Nominatim の category/type から推測したチェックポイント種別 */
  guessedType: CheckpointType;
};

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "trip-note/0.1 (https://trip.chobi.me)";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const MIN_INTERVAL_MS = 1000;

type CacheEntry = { at: number; places: Place[] };
type NominatimState = {
  cache: Map<string, CacheEntry>;
  queue: Promise<unknown>;
  lastFetchAt: number;
};

// dev サーバの HMR で状態が消えてもレート制限が壊れないよう globalThis に置く
const globalCache = globalThis as unknown as {
  __tripnoteNominatim?: NominatimState;
};

function state(): NominatimState {
  if (!globalCache.__tripnoteNominatim) {
    globalCache.__tripnoteNominatim = {
      cache: new Map(),
      queue: Promise.resolve(),
      lastFetchAt: 0,
    };
  }
  return globalCache.__tripnoteNominatim;
}

// リクエストを直列化し、実行間隔を MIN_INTERVAL_MS 以上空ける
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const s = state();
  const run = async () => {
    const wait = s.lastFetchAt + MIN_INTERVAL_MS - Date.now();
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

const LODGING_TYPES = new Set([
  "hotel",
  "motel",
  "hostel",
  "guest_house",
  "apartment",
  "chalet",
  "alpine_hut",
  "camp_site",
  "caravan_site",
]);

const RESTAURANT_TYPES = new Set([
  "restaurant",
  "fast_food",
  "food_court",
  "pub",
  "bar",
]);

export function guessCheckpointType(
  category: string,
  type: string,
): CheckpointType {
  if (category === "tourism") {
    return LODGING_TYPES.has(type) ? "lodging" : "sightseeing";
  }
  if (category === "amenity") {
    if (type === "cafe") return "cafe";
    if (RESTAURANT_TYPES.has(type)) return "restaurant";
  }
  if (category === "historic" || category === "leisure" || category === "natural") {
    return "sightseeing";
  }
  return "other";
}

type NominatimRow = {
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
  category: string;
  type: string;
};

async function fetchPlaces(
  query: string,
  viewbox: Viewbox | null,
): Promise<Place[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "8");
  url.searchParams.set("accept-language", "ja");
  // bounded は付けない = 範囲内を優先するだけで、範囲外の結果も返る
  if (viewbox) {
    url.searchParams.set("viewbox", viewbox.join(","));
  }
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`検索サービスがエラーを返しました (${response.status})`);
  }
  const rows = (await response.json()) as NominatimRow[];
  return rows.map((row) => ({
    name: row.name || row.display_name.split(",")[0].trim(),
    displayName: row.display_name,
    latitude: Number(row.lat),
    longitude: Number(row.lon),
    guessedType: guessCheckpointType(row.category, row.type),
  }));
}

/** viewbox はその日の経路の周辺(lib/day-route.ts の searchViewbox)。null なら全世界 */
export async function searchPlaces(
  query: string,
  viewbox: Viewbox | null = null,
): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const s = state();
  const key = viewbox ? `${q}|${viewbox.join(",")}` : q;
  const cached = s.cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.places;
  }
  const places = await throttled(() => fetchPlaces(q, viewbox));
  // 再挿入で挿入順を新しくし、あふれたら古いものから捨てる
  s.cache.delete(key);
  s.cache.set(key, { at: Date.now(), places });
  while (s.cache.size > CACHE_MAX_ENTRIES) {
    const oldest = s.cache.keys().next().value;
    if (oldest === undefined) break;
    s.cache.delete(oldest);
  }
  return places;
}
