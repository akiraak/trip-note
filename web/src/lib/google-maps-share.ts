// Google Maps の共有リンク(短縮 URL / 場所ページの URL)から場所を取り出す。
// 共有(iOS アプリの「共有」・ブラウザ版の「リンクをコピー」)で渡ってくるのは
// 場所名 + 短縮リンク(https://maps.app.goo.gl/XXXX)だけで、座標は短縮リンクを
// 展開した先の URL に入っている(形式は非公式で変わり得るため、パーサはここ 1 箇所に置き
// iOS もサーバ経由で使う)。
//
// 展開後 URL の例(2026-08-23 にブラウザで採取):
//   https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E/@36.238653,137.9688674,17z/
//     data=!3m1!4b1!4m6!3m5!1s0x601d0e850a9a5999:0x902d0e20fabcf654!8m2!3d36.238653!4d137.9688674!16zL20vMDM5cXE2?hl=ja
//   → `/maps/place/<名前>` が名前、`!3d<lat>!4d<lng>` がピンの座標、`@<lat>,<lng>` は表示中心

/** 共有リンクとして受け付けるホスト(短縮リンクの転送先もこの中に限る = SSRF 対策) */
export const GOOGLE_MAPS_HOSTS: ReadonlySet<string> = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "share.google",
  "maps.google.com",
  "www.google.com",
  "google.com",
  "maps.google.co.jp",
  "www.google.co.jp",
  "google.co.jp",
]);

/** 短縮リンクのホスト。これ以外(場所ページの URL)は座標が取れれば取得せずに済ませる */
const SHORT_LINK_HOSTS: ReadonlySet<string> = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "share.google",
]);

/** pin = ピンの座標、center = 地図の表示中心(ピンが無い共有ではこれが場所の位置) */
export type LinkPrecision = "pin" | "center";

export type ParsedGoogleMapsLink = {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  precision: LinkPrecision | null;
};

export type ResolvedGoogleMapsPlace = ParsedGoogleMapsLink & {
  /** 展開後(最終)の URL */
  resolvedUrl: string;
};

const USER_AGENT = "trip-note/0.1 (https://trip.chobi.me)";
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
export const MAX_LINK_LENGTH = 4000;

type CacheEntry = { at: number; place: ResolvedGoogleMapsPlace };
type ShareState = { cache: Map<string, CacheEntry> };

// dev サーバの HMR で状態が消えないよう globalThis に置く(nominatim と同方針)
const globalCache = globalThis as unknown as {
  __tripnoteGoogleMapsShare?: ShareState;
};

function state(): ShareState {
  if (!globalCache.__tripnoteGoogleMapsShare) {
    globalCache.__tripnoteGoogleMapsShare = { cache: new Map() };
  }
  return globalCache.__tripnoteGoogleMapsShare;
}

function hostOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isGoogleMapsUrl(value: string): boolean {
  const host = hostOf(value);
  return host !== null && GOOGLE_MAPS_HOSTS.has(host);
}

/**
 * 共有テキスト(「松本城\nhttps://maps.app.goo.gl/…」など)から Google Maps の URL を
 * 1 つ取り出す。URL そのものを渡してもよい。無ければ null
 */
export function extractGoogleMapsUrl(text: string): string | null {
  // URL に使える ASCII だけを取る(Google の URL は日本語もパーセント符号化済み)。
  // 括弧・引用符は本文側の記号とみなして含めない
  const matches = text.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+/g) ?? [];
  for (const raw of matches) {
    // 文末の句読点を落とす
    const candidate = raw.replace(/[.,;:!?]+$/, "");
    if (isGoogleMapsUrl(candidate)) return candidate;
  }
  return null;
}

const COORD_PAIR = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*(?:\((.*)\))?\s*$/;

function validCoordinate(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // 0,0 はピン無しのプレースホルダとして出ることがある
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

/** "36.23,137.96" / "36.23,137.96 (松本城)" → 座標(+ 括弧内のラベル) */
function parseCoordinateText(
  value: string,
): { latitude: number; longitude: number; label: string | null } | null {
  const match = value.match(COORD_PAIR);
  if (!match) return null;
  const coordinate = validCoordinate(Number(match[1]), Number(match[2]));
  if (!coordinate) return null;
  return { ...coordinate, label: match[3]?.trim() || null };
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, " ")).trim();
  } catch {
    return segment.replace(/\+/g, " ").trim();
  }
}

/**
 * 展開後の Google Maps URL から名前・座標を取り出す(純関数)。
 * 座標の優先順: data の `!3d<lat>!4d<lng>`(ピン)→ q / query / ll / center の
 * `lat,lng`(ピン)→ パスの `@<lat>,<lng>`(表示中心)。
 * Google Maps 以外のホスト・経路(`/maps/dir/`)のリンクは例外
 */
export function parseGoogleMapsUrl(value: string): ParsedGoogleMapsLink {
  const host = hostOf(value);
  if (!host || !GOOGLE_MAPS_HOSTS.has(host)) {
    throw new Error("Google Maps のリンクではありません");
  }
  const url = new URL(value);
  // Firebase Dynamic Links 形式(?link=<本来の URL>)は中身を見る
  const inner = url.searchParams.get("link");
  if (inner && isGoogleMapsUrl(inner)) {
    return parseGoogleMapsUrl(inner);
  }
  const path = url.pathname;
  if (/^\/maps\/dir(\/|$)/.test(path)) {
    throw new Error("経路のリンクは取り込めません(場所のリンクを共有してください)");
  }

  let name: string | null = null;
  let coordinate: { latitude: number; longitude: number } | null = null;
  let precision: LinkPrecision | null = null;

  // 1. data の !3d!4d(複数あれば最後 = 場所自身のもの)
  const pins = [...url.href.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  const lastPin = pins.at(-1);
  if (lastPin) {
    coordinate = validCoordinate(Number(lastPin[1]), Number(lastPin[2]));
    if (coordinate) precision = "pin";
  }

  // 2. クエリの座標(q / query / ll / center)
  for (const key of ["q", "query", "ll", "center"]) {
    const raw = url.searchParams.get(key);
    if (!raw) continue;
    const parsed = parseCoordinateText(raw);
    if (parsed) {
      if (!coordinate) {
        coordinate = { latitude: parsed.latitude, longitude: parsed.longitude };
        precision = "pin";
      }
      if (!name && parsed.label) name = parsed.label;
    } else if (!name && (key === "q" || key === "query")) {
      name = raw.trim() || null;
    }
  }

  // 3. パスの @lat,lng(表示中心)
  if (!coordinate) {
    const center = path.match(/\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (center) {
      coordinate = validCoordinate(Number(center[1]), Number(center[2]));
      if (coordinate) precision = "center";
    }
  }

  // 名前: /maps/place/<名前> → /maps/search/<名前>(座標そのものなら名前ではない)
  const named = path.match(/^\/maps\/(?:place|search)\/([^/]+)/);
  if (named) {
    const decoded = decodePathSegment(named[1]);
    if (decoded && !parseCoordinateText(decoded) && !decoded.startsWith("@")) {
      name = decoded;
    }
  }

  return {
    name: name || null,
    latitude: coordinate?.latitude ?? null,
    longitude: coordinate?.longitude ?? null,
    precision: coordinate ? precision : null,
  };
}

// 注意: 展開後の URL に座標が無いとき、ページ本文(og:image の staticmap center など)から
// 座標を拾うのは**やらない**。名前だけの場所ページ・検索ページの本文に出る座標は
// 接続元 IP から推定した既定の地図中心(g3plus だとシアトル)で、場所とは無関係
// (2026-08-23 に確認)。座標が取れないリンクは名前だけ返し、クライアントが名前で検索する

function hasCoordinate(parsed: ParsedGoogleMapsLink): boolean {
  return parsed.latitude !== null && parsed.longitude !== null;
}

function checkRedirectTarget(location: string, base: string): string {
  const next = new URL(location, base);
  const host = next.hostname.toLowerCase();
  if (next.protocol !== "https:" || !GOOGLE_MAPS_HOSTS.has(host)) {
    throw new Error("リンクの転送先が Google Maps ではないため取り込めません");
  }
  return next.href;
}

/** 短縮リンクの転送を追って最終 URL を返す(本文は使わない) */
async function expandLink(start: string, fetchImpl: typeof fetch): Promise<string> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ja" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("リンクの展開に失敗しました(転送先がありません)");
      current = checkRedirectTarget(location, current);
      continue;
    }
    if (!response.ok) {
      throw new Error(`リンクの展開に失敗しました (${response.status})`);
    }
    return current;
  }
  throw new Error("リンクの転送が多すぎます");
}

/**
 * 共有テキスト / URL から場所を解決する。長い URL に座標があれば取得せずに済ませ、
 * 短縮リンクは転送を追って展開する。同じリンクは 24 時間キャッシュ
 */
export async function resolveGoogleMapsLink(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedGoogleMapsPlace> {
  const url = extractGoogleMapsUrl(input);
  if (!url) {
    throw new Error("Google Maps のリンクが見つかりません");
  }
  const s = state();
  const cached = s.cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.place;
  }

  let place: ResolvedGoogleMapsPlace;
  const direct = parseGoogleMapsUrl(url);
  const host = hostOf(url) ?? "";
  if (hasCoordinate(direct) && !SHORT_LINK_HOSTS.has(host)) {
    place = { ...direct, resolvedUrl: url };
  } else {
    const resolvedUrl = await expandLink(url, fetchImpl);
    place = { ...parseGoogleMapsUrl(resolvedUrl), resolvedUrl };
  }
  if (!place.name && !hasCoordinate(place)) {
    throw new Error("リンクから場所を特定できませんでした");
  }

  s.cache.delete(url);
  s.cache.set(url, { at: Date.now(), place });
  while (s.cache.size > CACHE_MAX_ENTRIES) {
    const oldest = s.cache.keys().next().value;
    if (oldest === undefined) break;
    s.cache.delete(oldest);
  }
  return place;
}

/** API / Server Action の入力検証。文字列(共有テキスト or URL)のみ受け付ける */
export function parseLinkInput(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("リンクを入力してください");
  }
  if (value.length > MAX_LINK_LENGTH) {
    throw new Error("リンクが長すぎます");
  }
  return value.trim();
}
