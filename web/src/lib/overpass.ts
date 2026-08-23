import type { SearchCategory } from "./category-search";
import type { DayRoutePlace } from "./day-route";
import { haversineDistance } from "./geo";

// OSM Overpass API をサーバ経由でプロキシし、その日の経路(折れ線)沿いを
// カテゴリ(観光地など)で検索する。公開サーバ利用の作法は nominatim / routing と同じ:
//   - アプリを特定できる User-Agent を送る
//   - リクエストは直列化して間隔を空ける(最大 1 req/s)
//   - 同じ条件の結果をキャッシュして再送を避ける
// 単一ユーザー・単一プロセス運用なのでプロセス内での制御で足りる

export type NearbyPlace = {
  /** OSM の要素 id("node/123" 形式) */
  id: string;
  name: string;
  /** OSM のタグ値(castle / museum / viewpoint …) */
  kind: string;
  kindLabel: string;
  latitude: number;
  longitude: number;
  /** 経路上の最寄り地点までの直線距離 */
  distanceM: number;
  nearestRouteName: string;
  wikipediaUrl: string | null;
  website: string | null;
};

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "trip-note/0.1 (https://trip.chobi.me)";
const FETCH_TIMEOUT_MS = 40_000;
const QUERY_TIMEOUT_S = 25;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
/** 経路(折れ線)からこの距離以内を探す */
export const SEARCH_RADIUS_M = 15_000;
/** Overpass から受け取る上限(有名どころ / その他それぞれ) */
const NOTABLE_LIMIT = 100;
const OTHER_LIMIT = 60;
/** クライアントへ返す上限 */
export const RESULT_LIMIT = 30;

function endpoint(): string {
  return process.env.OVERPASS_ENDPOINT || DEFAULT_ENDPOINT;
}

// テストからの上書き用に遅延評価にしている(通常は未設定 = 1 秒)
function minIntervalMs(): number {
  const value = Number(process.env.OVERPASS_MIN_INTERVAL_MS);
  return Number.isFinite(value) && value >= 0 ? value : 1000;
}

// ---- カテゴリごとの対象タグ(ここで調整する) ----

type Selector = {
  /** Overpass のタグフィルタ(例: ["tourism"~"^(attraction|museum)$"]) */
  filter: string;
  /** wikipedia / wikidata タグがあるものだけに絞る(寺社・温泉など無数にあるもの) */
  notableOnly: boolean;
};

const SELECTORS: Record<SearchCategory, Selector[]> = {
  sightseeing: [
    {
      filter: `["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$"]`,
      notableOnly: false,
    },
    {
      filter: `["historic"~"^(castle|monument|memorial|ruins|archaeological_site)$"]`,
      notableOnly: false,
    },
    { filter: `["amenity"="place_of_worship"]`, notableOnly: true },
    { filter: `["natural"~"^(waterfall|hot_spring)$"]`, notableOnly: true },
  ],
};

/** 種類の判定順(松本城のように castle + museum を持つものは城として扱う) */
const KIND_KEYS = ["historic", "tourism", "natural", "amenity"] as const;

const KIND_LABELS: Record<string, string> = {
  castle: "城",
  monument: "記念碑",
  memorial: "記念碑",
  ruins: "遺跡",
  archaeological_site: "遺跡",
  attraction: "観光スポット",
  museum: "博物館",
  gallery: "美術館",
  viewpoint: "展望スポット",
  zoo: "動物園",
  aquarium: "水族館",
  theme_park: "テーマパーク",
  waterfall: "滝",
  hot_spring: "温泉",
  place_of_worship: "寺社",
};

/** 並び順の重み(有名どころ優先の次に効く。城・主要スポット > 博物館・寺社 > 記念碑) */
const KIND_WEIGHTS: Record<string, number> = {
  castle: 3,
  attraction: 3,
  theme_park: 3,
  zoo: 3,
  aquarium: 3,
  museum: 2,
  gallery: 2,
  viewpoint: 2,
  place_of_worship: 2,
  waterfall: 2,
  hot_spring: 2,
  ruins: 1,
  archaeological_site: 1,
  monument: 1,
  memorial: 1,
};

// ---- クエリ組み立て ----

export type LatLng = { latitude: number; longitude: number };

export function routeCoordinates(route: DayRoutePlace[]): LatLng[] {
  return route.flatMap((p) =>
    p.latitude !== null && p.longitude !== null
      ? [{ latitude: p.latitude, longitude: p.longitude }]
      : [],
  );
}

/**
 * 経路沿い検索の Overpass QL。`around:` に折れ線の座標列を渡し、設定行の `[bbox:]` で
 * 全体を経路の外接矩形 + 半径に絞る(bbox 無しだと relation の around が数十秒かかる)。
 * 出力は「有名どころ(wikipedia / wikidata あり)」→「その他」の順で別々に上限を掛ける
 */
export function buildOverpassQuery(
  category: SearchCategory,
  points: LatLng[],
  radiusM: number = SEARCH_RADIUS_M,
): string {
  if (points.length === 0) throw new Error("経路に座標がありません");
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLat = radiusM / 111_320;
  const padLon =
    radiusM / (111_320 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01));
  const r = (v: number) => v.toFixed(4);
  const bbox = [
    r(Math.max(Math.min(...lats) - padLat, -90)),
    r(Math.min(...lons) - padLon),
    r(Math.min(Math.max(...lats) + padLat, 90)),
    r(Math.max(...lons) + padLon),
  ].join(",");
  const around = `around:${radiusM},${points
    .map((p) => `${r(p.latitude)},${r(p.longitude)}`)
    .join(",")}`;
  const statements = SELECTORS[category].map(
    (s) =>
      `  nwr${s.filter}${s.notableOnly ? `["wikipedia"]` : ""}["name"](${around});`,
  );
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}][bbox:${bbox}];`,
    "(",
    ...statements,
    ")->.all;",
    `(nwr.all["wikipedia"]; nwr.all["wikidata"];)->.notable;`,
    `.notable out center tags ${NOTABLE_LIMIT};`,
    "(.all; - .notable;)->.rest;",
    `.rest out center tags ${OTHER_LIMIT};`,
  ].join("\n");
}

// ---- 応答のパース・並び替え ----

export type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
  remark?: string;
};

/** 並び替え前の候補(経路との距離は未計算) */
export type NearbyCandidate = Omit<NearbyPlace, "distanceM" | "nearestRouteName"> & {
  notable: boolean;
};

export function wikipediaUrl(tag: string | undefined): string | null {
  if (!tag) return null;
  // "ja:松本城" 形式。言語プレフィックスが無ければ en とみなす
  const match = /^([a-z][a-z\-]*):(.*)$/i.exec(tag.trim());
  const lang = match ? match[1].toLowerCase() : "en";
  const title = (match ? match[2] : tag).trim();
  if (!title) return null;
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

export function parseOverpassElements(elements: OverpassElement[]): NearbyCandidate[] {
  const candidates: NearbyCandidate[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = (tags["name:ja"] || tags.name || "").trim();
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!name || typeof lat !== "number" || typeof lon !== "number") continue;
    const kind = KIND_KEYS.map((key) => tags[key]).find(
      (value) => value && KIND_LABELS[value],
    );
    if (!kind) continue;
    candidates.push({
      id: `${element.type}/${element.id}`,
      name,
      kind,
      kindLabel: KIND_LABELS[kind],
      latitude: lat,
      longitude: lon,
      wikipediaUrl: wikipediaUrl(tags.wikipedia),
      website: tags.website || tags["contact:website"] || null,
      notable: Boolean(tags.wikipedia || tags.wikidata),
    });
  }
  return candidates;
}

/** 有名どころ → 種類の重み → 経路から近い順に並べ、上限まで返す */
export function rankNearby(
  candidates: NearbyCandidate[],
  route: DayRoutePlace[],
  limit: number = RESULT_LIMIT,
): NearbyPlace[] {
  const anchors = route.filter(
    (p): p is DayRoutePlace & LatLng => p.latitude !== null && p.longitude !== null,
  );
  const ranked = candidates.map((candidate) => {
    let distanceM = Number.POSITIVE_INFINITY;
    let nearestRouteName = "";
    for (const anchor of anchors) {
      const d = haversineDistance(
        candidate.latitude,
        candidate.longitude,
        anchor.latitude,
        anchor.longitude,
      );
      if (d < distanceM) {
        distanceM = d;
        nearestRouteName = anchor.name;
      }
    }
    const { notable, ...place } = candidate;
    return {
      place: { ...place, distanceM: Math.round(distanceM), nearestRouteName },
      score: (notable ? 10 : 0) + (KIND_WEIGHTS[candidate.kind] ?? 0),
    };
  });
  ranked.sort(
    (a, b) => b.score - a.score || a.place.distanceM - b.place.distanceM,
  );
  return ranked.slice(0, limit).map((r) => r.place);
}

// ---- 取得(キャッシュ + スロットル) ----

type CacheEntry = { at: number; places: NearbyPlace[] };
type OverpassState = {
  cache: Map<string, CacheEntry>;
  queue: Promise<unknown>;
  lastFetchAt: number;
};

// dev サーバの HMR で状態が消えてもレート制限が壊れないよう globalThis に置く
const globalCache = globalThis as unknown as {
  __tripnoteOverpass?: OverpassState;
};

function state(): OverpassState {
  if (!globalCache.__tripnoteOverpass) {
    globalCache.__tripnoteOverpass = {
      cache: new Map(),
      queue: Promise.resolve(),
      lastFetchAt: 0,
    };
  }
  return globalCache.__tripnoteOverpass;
}

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

/** キャッシュキー。座標を小数 3 桁(約 100m)で丸めるので CP の微修正では再取得しない */
export function nearbyCacheKey(
  category: SearchCategory,
  route: DayRoutePlace[],
): string {
  const points = routeCoordinates(route)
    .map((p) => `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`)
    .join(";");
  return `${category}|${points}`;
}

async function fetchFromOverpass(query: string): Promise<OverpassElement[]> {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: query }),
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`検索サービスがエラーを返しました (${response.status})`);
  }
  const json = (await response.json()) as OverpassResponse;
  // タイムアウト等は 200 のまま remark に入る(elements は空)
  if (json.remark && /error/i.test(json.remark)) {
    throw new Error(`検索サービスがエラーを返しました: ${json.remark}`);
  }
  return json.elements ?? [];
}

/** その日の経路沿いをカテゴリで検索する。経路に座標が無ければ例外 */
export async function fetchNearbyPlaces(
  category: SearchCategory,
  route: DayRoutePlace[],
): Promise<NearbyPlace[]> {
  const points = routeCoordinates(route);
  if (points.length === 0) throw new Error("経路に座標がありません");
  const s = state();
  const key = nearbyCacheKey(category, route);
  const cached = s.cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.places;
  }
  const elements = await throttled(() =>
    fetchFromOverpass(buildOverpassQuery(category, points)),
  );
  const places = rankNearby(parseOverpassElements(elements), route);
  s.cache.delete(key);
  s.cache.set(key, { at: Date.now(), places });
  while (s.cache.size > CACHE_MAX_ENTRIES) {
    const oldest = s.cache.keys().next().value;
    if (oldest === undefined) break;
    s.cache.delete(oldest);
  }
  return places;
}
