import { describe, expect, it } from "vitest";
import { shareSummaryLine } from "@/lib/share-summary";

// 共有ページの見出しの 1 行と OGP の説明文に使う文面(lib/share-summary.ts)

describe("shareSummaryLine", () => {
  it("期間・日数・枚数を並べる(2 日目以降は月日だけ)", () => {
    expect(
      shareSummaryLine({
        firstDate: "2026-09-01",
        lastDate: "2026-09-03",
        dayCount: 3,
        photoCount: 12,
        videoCount: 0,
      }),
    ).toBe("2026/09/01 – 09/03 · 3日間 · 写真 12 枚");
  });

  it("1 日の旅行は期間を 1 つだけ出す", () => {
    expect(
      shareSummaryLine({
        firstDate: "2026-09-01",
        lastDate: "2026-09-01",
        dayCount: 1,
        photoCount: 2,
        videoCount: 0,
      }),
    ).toBe("2026/09/01 · 1日間 · 写真 2 枚");
  });

  it("動画が混ざっていれば「件」で数える", () => {
    expect(
      shareSummaryLine({
        firstDate: null,
        lastDate: null,
        dayCount: 0,
        photoCount: 3,
        videoCount: 1,
      }),
    ).toBe("写真・動画 4 件");
  });

  it("出せる項目が無ければ空文字", () => {
    expect(
      shareSummaryLine({
        firstDate: null,
        lastDate: null,
        dayCount: 0,
        photoCount: 0,
        videoCount: 0,
      }),
    ).toBe("");
  });
});
