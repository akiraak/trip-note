// 検索欄の入力が「観光地」のようなカテゴリ語なら、地名検索ではなく
// その日の経路の近くをカテゴリで探す(lib/overpass.ts)。判定表はここだけ。
// iOS 側 ios/TripNote/Domain/CategorySearch.swift と揃える

export const SEARCH_CATEGORIES = ["sightseeing"] as const;
export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

const KEYWORDS: Record<SearchCategory, readonly string[]> = {
  sightseeing: ["観光地", "観光", "観光スポット", "名所"],
};

export const CATEGORY_LABELS: Record<SearchCategory, string> = {
  sightseeing: "観光地",
};

/** 入力(trim 後の完全一致)がカテゴリ語ならそのカテゴリ、違えば null */
export function searchCategory(query: string): SearchCategory | null {
  const q = query.trim();
  for (const category of SEARCH_CATEGORIES) {
    if (KEYWORDS[category].includes(q)) return category;
  }
  return null;
}

export function isSearchCategory(value: unknown): value is SearchCategory {
  return (
    typeof value === "string" &&
    (SEARCH_CATEGORIES as readonly string[]).includes(value)
  );
}
