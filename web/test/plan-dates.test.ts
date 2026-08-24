import { describe, expect, it } from "vitest";
import {
  dayDifference,
  departureShiftDays,
  planShiftNotice,
} from "@/lib/plan-dates";

// 出発日の変更にプランを追従させる規則(lib/plan-dates.ts)。
// iOS の PlanEditor.departureShiftDays / planShiftNotice と同じ規則なので、
// ケースは ios/TripNoteTests/PlanEditorTests.swift と対応させている

describe("dayDifference", () => {
  it("暦日の差を返す(月・年をまたぐ)", () => {
    expect(dayDifference("2026-09-01", "2026-09-04")).toBe(3);
    expect(dayDifference("2026-09-04", "2026-09-01")).toBe(-3);
    expect(dayDifference("2026-09-30", "2026-10-01")).toBe(1);
    expect(dayDifference("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("夏時間をまたいでも 24 時間ではなく暦日で数える", () => {
    // 2026-11-01 に PDT → PST(この間だけ 25 時間の日がある)
    expect(dayDifference("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("同じ日は 0、不正な日付も 0", () => {
    expect(dayDifference("2026-09-01", "2026-09-01")).toBe(0);
    expect(dayDifference("2026/09/01", "2026-09-04")).toBe(0);
  });
});

describe("departureShiftDays", () => {
  it("1 日目が新しい出発日になる日数を返す", () => {
    expect(departureShiftDays("2026-09-01", "2026-09-04", "2026-09-01")).toBe(3);
    // 前倒しはマイナス
    expect(departureShiftDays("2026-09-04", "2026-09-01", "2026-09-04")).toBe(-3);
  });

  it("1 日目が出発日とずれていてもそろえる", () => {
    // 出発 9/1 なのに 1 日目が 8/31 だった旅行で、出発を 9/4 にしたら 1 日目も 9/4 にする
    expect(departureShiftDays("2026-09-01", "2026-09-04", "2026-08-31")).toBe(4);
  });

  it("出発日が変わっていなければ動かさない(時刻だけの変更)", () => {
    expect(departureShiftDays("2026-09-01", "2026-09-01", "2026-09-01")).toBe(0);
    // 1 日目がずれていても、触っていない出発日でプランが動くと驚くので 0
    expect(departureShiftDays("2026-09-01", "2026-09-01", "2026-08-31")).toBe(0);
  });

  it("旧出発日が無ければ 1 日目を新しい出発日に合わせる", () => {
    expect(departureShiftDays(null, "2026-09-05", "2026-09-01")).toBe(4);
  });

  it("出発日を消したときと日が 1 つも無いときは 0", () => {
    expect(departureShiftDays("2026-09-01", null, "2026-09-01")).toBe(0);
    expect(departureShiftDays("2026-09-01", "2026-09-04", null)).toBe(0);
  });
});

describe("planShiftNotice", () => {
  it("動く向きと日数を出す(動かないなら null)", () => {
    expect(planShiftNotice(3)).toBe("プランの日付も 3 日うしろへ動きます");
    expect(planShiftNotice(-2)).toBe("プランの日付も 2 日まえへ動きます");
    expect(planShiftNotice(0)).toBeNull();
  });
});
