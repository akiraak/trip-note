import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import {
  AI_MODELS,
  DEFAULT_AI_MODEL_ID,
  buildPlanPrompt,
  buildTripOutlinePrompt,
  getAiModel,
  parsePlanInput,
  parsePlanSuggestion,
  parseSearchAssistInput,
  parseSearchAssistSuggestion,
  parseTripOutlineInput,
  parseTripOutlineSuggestion,
  setAiModel,
} from "@/lib/ai";
import { getDb } from "@/lib/db";

// AI 提案・検索補助(lib/ai.ts)のうち、実 API 呼び出し以外を検証する:
// モデル設定(app_settings)・入力バリデーション・応答パース・プロンプト生成。
// 実 API の呼び出しは手動確認(プランのテスト方針)

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-note-test-"));
  process.env.TRIPNOTE_DB_PATH = path.join(tempDir, "test.db");
});

afterEach(() => {
  const cache = globalThis as unknown as { __tripnoteDb?: Database.Database };
  cache.__tripnoteDb?.close();
  cache.__tripnoteDb = undefined;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("AI モデル設定", () => {
  it("未設定なら既定モデルを返す", () => {
    expect(getAiModel().id).toBe(DEFAULT_AI_MODEL_ID);
  });

  it("許可リストのモデルを保存・取得できる", () => {
    setAiModel("gpt-5.6-terra");
    expect(getAiModel().id).toBe("gpt-5.6-terra");
    expect(getAiModel().provider).toBe("openai");
    // 上書き
    setAiModel("claude-sonnet-5");
    expect(getAiModel().id).toBe("claude-sonnet-5");
  });

  it("許可リスト外のモデルは拒否する", () => {
    expect(() => setAiModel("claude-haiku-4-5")).toThrow(/許可されていない/);
  });

  it("保存済みの値が許可リストから外れたら既定に落とす", () => {
    getDb()
      .prepare(
        "insert into app_settings (key, value) values ('ai_model', 'retired-model')",
      )
      .run();
    expect(getAiModel().id).toBe(DEFAULT_AI_MODEL_ID);
  });

  it("許可リストは 4 モデル(Claude 2 + ChatGPT 2)", () => {
    expect(AI_MODELS).toHaveLength(4);
    expect(AI_MODELS.filter((m) => m.provider === "anthropic")).toHaveLength(2);
    expect(AI_MODELS.filter((m) => m.provider === "openai")).toHaveLength(2);
  });
});

describe("parsePlanInput", () => {
  const valid = {
    departure: "東京駅",
    destination: "自宅",
    startDate: "2026-09-01",
    dayCount: 3,
    transport: "car",
    request: "温泉に入りたい",
  };

  it("正常な入力を受け付ける", () => {
    expect(parsePlanInput(valid)).toEqual(valid);
  });

  it("transport / request は省略できる", () => {
    const input = parsePlanInput({
      departure: "東京駅",
      destination: "自宅",
      startDate: "2026-09-01",
      dayCount: 1,
    });
    expect(input.transport).toBeNull();
    expect(input.request).toBeNull();
  });

  it("出発地・到着予定地が空なら拒否する", () => {
    expect(() => parsePlanInput({ ...valid, departure: " " })).toThrow(
      /出発地/,
    );
    expect(() => parsePlanInput({ ...valid, destination: "" })).toThrow(
      /到着予定地/,
    );
  });

  it("開始日の形式と日数の範囲を検証する", () => {
    expect(() => parsePlanInput({ ...valid, startDate: "9/1" })).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => parsePlanInput({ ...valid, dayCount: 0 })).toThrow(/日数/);
    expect(() => parsePlanInput({ ...valid, dayCount: 31 })).toThrow(/日数/);
    expect(() => parsePlanInput({ ...valid, dayCount: 1.5 })).toThrow(/日数/);
  });
});

describe("parseTripOutlineInput", () => {
  const valid = {
    destination: "シカゴ",
    departureDate: "2026-09-01",
    departureTime: "08:30",
    departure: "シアトル 5th Ave",
    departureLatitude: 47.6062,
    departureLongitude: -122.3321,
    transport: "car",
    request: "温泉に入りたい",
  };

  it("正常な入力を受け付ける", () => {
    expect(parseTripOutlineInput(valid)).toEqual(valid);
  });

  it("departure / 座標 / transport / request は省略できる", () => {
    const input = parseTripOutlineInput({
      destination: "上高地",
      departureDate: "2026-09-01",
      departureTime: "08:30",
    });
    expect(input.departure).toBeNull();
    expect(input.departureLatitude).toBeNull();
    expect(input.departureLongitude).toBeNull();
    expect(input.transport).toBeNull();
    expect(input.request).toBeNull();
  });

  it("範囲外・数値でない座標は拒否する", () => {
    expect(() =>
      parseTripOutlineInput({ ...valid, departureLatitude: 91 }),
    ).toThrow(/座標/);
    expect(() =>
      parseTripOutlineInput({ ...valid, departureLongitude: "西経" }),
    ).toThrow(/座標/);
  });

  it("目的地が空なら拒否する", () => {
    expect(() => parseTripOutlineInput({ ...valid, destination: " " })).toThrow(
      /目的地/,
    );
  });

  it("出発日・出発時刻の形式を検証する", () => {
    expect(() =>
      parseTripOutlineInput({ ...valid, departureDate: "9/1" }),
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      parseTripOutlineInput({ ...valid, departureTime: "8時半" }),
    ).toThrow(/HH:mm/);
    expect(() =>
      parseTripOutlineInput({ ...valid, departureTime: "25:00" }),
    ).toThrow(/HH:mm/);
  });
});

describe("parseSearchAssistInput", () => {
  it("正常な入力を受け付ける", () => {
    expect(
      parseSearchAssistInput({ area: "松本市周辺", type: "cafe", request: "" }),
    ).toEqual({ area: "松本市周辺", type: "cafe", request: null });
  });

  it("地域が空・種別が不正なら拒否する", () => {
    expect(() => parseSearchAssistInput({ area: "" })).toThrow(/地域/);
    expect(() =>
      parseSearchAssistInput({ area: "松本", type: "hotel" }),
    ).toThrow(/種別/);
  });
});

describe("parsePlanSuggestion", () => {
  const day = {
    date: "2026-09-01",
    title: "松本周辺を観光して泊",
    area: "松本市",
    checkpoints: [
      { type: "departure", name: "東京駅", note: "" },
      { type: "sightseeing", name: "松本城", note: "国宝" },
    ],
  };

  it("正常な応答をパースし、空文字 note は null に寄せる", () => {
    const suggestion = parsePlanSuggestion({ days: [day] });
    expect(suggestion.days).toHaveLength(1);
    expect(suggestion.days[0].checkpoints[0].note).toBeNull();
    expect(suggestion.days[0].checkpoints[1].note).toBe("国宝");
  });

  it("チェックポイントの概算座標を通し、不正・片方だけは null に寄せる", () => {
    const suggestion = parsePlanSuggestion({
      days: [
        {
          ...day,
          checkpoints: [
            { type: "sightseeing", name: "松本城", note: "", latitude: 36.2381, longitude: 137.969 },
            { type: "lodging", name: "宿", note: "", latitude: 36.26 },
            { type: "cafe", name: "喫茶店", note: "", latitude: 91, longitude: 137 },
          ],
        },
      ],
    });
    const checkpoints = suggestion.days[0].checkpoints;
    expect([checkpoints[0].latitude, checkpoints[0].longitude]).toEqual([36.2381, 137.969]);
    expect([checkpoints[1].latitude, checkpoints[1].longitude]).toEqual([null, null]);
    expect([checkpoints[2].latitude, checkpoints[2].longitude]).toEqual([null, null]);
  });

  it("許可リスト外の種別は other に寄せる", () => {
    const suggestion = parsePlanSuggestion({
      days: [
        {
          ...day,
          checkpoints: [{ type: "onsen", name: "浅間温泉", note: "" }],
        },
      ],
    });
    expect(suggestion.days[0].checkpoints[0].type).toBe("other");
  });

  it("構造が不正なら throw する", () => {
    expect(() => parsePlanSuggestion(null)).toThrow(/解釈/);
    expect(() => parsePlanSuggestion({ days: [] })).toThrow(/解釈/);
    expect(() =>
      parsePlanSuggestion({ days: [{ ...day, date: "9月1日" }] }),
    ).toThrow(/解釈/);
    expect(() =>
      parsePlanSuggestion({
        days: [{ ...day, checkpoints: [{ type: "cafe", name: "" }] }],
      }),
    ).toThrow(/解釈/);
  });
});

describe("parseTripOutlineSuggestion", () => {
  const candidate = {
    dayCount: 3,
    title: "2泊3日でゆったり",
    nights: [
      {
        area: "松本市街",
        name: "松本駅周辺のホテル",
        note: "",
        latitude: 36.23,
        longitude: 137.97,
      },
      { area: "上高地", name: "上高地帝国ホテル周辺の宿", note: "要予約" },
    ],
  };

  it("正常な応答をパースし、空文字 note は null に寄せる", () => {
    const suggestion = parseTripOutlineSuggestion({ candidates: [candidate] });
    expect(suggestion.candidates).toHaveLength(1);
    expect(suggestion.candidates[0].nights[0].note).toBeNull();
    expect(suggestion.candidates[0].nights[1].note).toBe("要予約");
  });

  it("目的地の概算座標を通し、不正・欠落は null に寄せる", () => {
    const withCoords = parseTripOutlineSuggestion({
      candidates: [candidate],
      destinationLatitude: 41.8781,
      destinationLongitude: -87.6298,
    });
    expect(withCoords.destinationLatitude).toBe(41.8781);
    expect(withCoords.destinationLongitude).toBe(-87.6298);

    const invalid = parseTripOutlineSuggestion({
      candidates: [candidate],
      destinationLatitude: 91,
      destinationLongitude: -87.6298,
    });
    expect(invalid.destinationLatitude).toBeNull();
    expect(invalid.destinationLongitude).toBeNull();

    const missing = parseTripOutlineSuggestion({ candidates: [candidate] });
    expect(missing.destinationLatitude).toBeNull();
  });

  it("泊の概算座標は範囲内なら通し、不正・欠落は null に寄せる", () => {
    const suggestion = parseTripOutlineSuggestion({
      candidates: [
        {
          ...candidate,
          nights: [
            ...candidate.nights,
            { area: "変な値", name: "宿", note: "", latitude: 91, longitude: "東経" },
          ],
        },
      ],
    });
    const nights = suggestion.candidates[0].nights;
    expect(nights[0].latitude).toBe(36.23);
    expect(nights[0].longitude).toBe(137.97);
    expect(nights[1].latitude).toBeNull();  // 欠落
    expect(nights[2].latitude).toBeNull();  // 範囲外
    expect(nights[2].longitude).toBeNull();  // 数値でない
  });

  it("日数が範囲外の候補は落とし、全滅なら throw する", () => {
    const suggestion = parseTripOutlineSuggestion({
      candidates: [candidate, { ...candidate, dayCount: 0 }],
    });
    expect(suggestion.candidates).toHaveLength(1);
    expect(() =>
      parseTripOutlineSuggestion({
        candidates: [{ ...candidate, dayCount: 31 }],
      }),
    ).toThrow(/候補/);
  });

  it("構造が不正なら throw する", () => {
    expect(() => parseTripOutlineSuggestion(null)).toThrow(/解釈/);
    expect(() =>
      parseTripOutlineSuggestion({
        candidates: [{ ...candidate, dayCount: 2.5 }],
      }),
    ).toThrow(/解釈/);
    expect(() =>
      parseTripOutlineSuggestion({
        candidates: [{ ...candidate, nights: [{ area: "松本", name: "" }] }],
      }),
    ).toThrow(/解釈/);
  });
});

describe("parseSearchAssistSuggestion", () => {
  it("正常な応答をパースする", () => {
    const suggestion = parseSearchAssistSuggestion({
      queries: [" 松本市 カフェ ", ""],
      places: [{ name: "珈琲まるも", type: "cafe", area: "松本市", note: "" }],
    });
    expect(suggestion.queries).toEqual(["松本市 カフェ"]);
    expect(suggestion.places[0]).toEqual({
      name: "珈琲まるも",
      type: "cafe",
      area: "松本市",
      note: null,
    });
  });

  it("クエリも地点も無ければ throw する", () => {
    expect(() =>
      parseSearchAssistSuggestion({ queries: [], places: [] }),
    ).toThrow(/候補/);
  });
});

describe("buildPlanPrompt", () => {
  it("入力の全項目をプロンプトに含める", () => {
    const { system, user } = buildPlanPrompt({
      departure: "東京駅",
      destination: "自宅",
      startDate: "2026-09-01",
      dayCount: 3,
      transport: "car",
      request: "温泉に入りたい",
    });
    expect(system).toContain("departure");
    expect(user).toContain("東京駅");
    expect(user).toContain("自宅");
    expect(user).toContain("2026-09-01");
    expect(user).toContain("3日");
    expect(user).toContain("car");
    expect(user).toContain("温泉に入りたい");
  });
});

describe("buildTripOutlinePrompt", () => {
  it("入力の全項目をプロンプトに含める", () => {
    const { system, user } = buildTripOutlinePrompt({
      destination: "シカゴ",
      departureDate: "2026-09-01",
      departureTime: "08:30",
      departure: "シアトル",
      departureLatitude: 47.6062,
      departureLongitude: -122.3321,
      transport: "car",
      request: "温泉に入りたい",
    });
    expect(system).toContain("candidates");
    // 長距離移動は経路上の中継地で宿泊しながら向かう指示
    expect(system).toContain("経路上の中継地");
    expect(user).toContain("シアトル");
    expect(user).toContain("47.6062, -122.3321");
    expect(user).toContain("シカゴ");
    expect(user).toContain("2026-09-01 08:30");
    expect(user).toContain("car");
    expect(user).toContain("温泉に入りたい");
  });

  it("座標が無ければ座標行を出さない", () => {
    const { user } = buildTripOutlinePrompt({
      destination: "上高地",
      departureDate: "2026-09-01",
      departureTime: "08:30",
      departure: null,
      departureLatitude: null,
      departureLongitude: null,
      transport: null,
      request: null,
    });
    expect(user).not.toContain("座標");
  });
});
