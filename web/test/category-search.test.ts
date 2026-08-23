import { describe, expect, it } from "vitest";
import { isSearchCategory, searchCategory } from "@/lib/category-search";

describe("searchCategory", () => {
  it("「観光地」などの完全一致だけカテゴリ検索にする", () => {
    expect(searchCategory("観光地")).toBe("sightseeing");
    expect(searchCategory(" 観光 ")).toBe("sightseeing");
    expect(searchCategory("観光スポット")).toBe("sightseeing");
    expect(searchCategory("名所")).toBe("sightseeing");
    expect(searchCategory("松本城")).toBeNull();
    expect(searchCategory("松本 観光地")).toBeNull();
    expect(searchCategory("")).toBeNull();
  });

  it("isSearchCategory は定義済みのカテゴリだけ通す", () => {
    expect(isSearchCategory("sightseeing")).toBe(true);
    expect(isSearchCategory("cafe")).toBe(false);
    expect(isSearchCategory(null)).toBe(false);
  });
});
