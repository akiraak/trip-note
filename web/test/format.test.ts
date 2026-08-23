import { describe, expect, it } from "vitest";
import { formatDay } from "@/lib/format";

// 表示整形(lib/format.ts)のうち、日付だけの値(trip_days.date)を扱う formatDay を
// 検証する。表示 TZ (America/Los_Angeles) でずらさないよう UTC 固定である点が肝

describe("formatDay", () => {
  it("YYYY-MM-DD を Aug 25 形式にする", () => {
    expect(formatDay("2026-08-25")).toBe("Aug 25");
    expect(formatDay("2026-09-05")).toBe("Sep 5");
  });

  it("表示 TZ で前日にずれない(月初・月末・年末)", () => {
    expect(formatDay("2026-09-01")).toBe("Sep 1");
    expect(formatDay("2026-08-31")).toBe("Aug 31");
    expect(formatDay("2026-12-31")).toBe("Dec 31");
    expect(formatDay("2027-01-01")).toBe("Jan 1");
  });
});
