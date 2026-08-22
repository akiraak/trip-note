import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getDb } from "./db";
import { CHECKPOINT_TYPES, type CheckpointType } from "./types";

// AI 提案・検索補助の共通ロジック。プロバイダは Claude (Anthropic API) と
// ChatGPT (OpenAI API) の 2 系統で、API キーはサーバ側のみ。
// iOS は /api/ai/*(Bearer)、Web は Server Action からこのモジュールを直接呼ぶ。
// 構造化出力は両プロバイダとも JSON Schema 指定
// (Anthropic = output_config.format / OpenAI = Responses API の text.format)

export type AiProvider = "anthropic" | "openai";

export type AiModel = {
  provider: AiProvider;
  /** API に渡すモデル ID。app_settings の ai_model にもこの値を保存する */
  id: string;
  label: string;
  /** $/1M トークン(入力/出力)。設定画面の表示用(2026-08 時点) */
  pricing: string;
  note: string;
};

// モデルの許可リスト。設定画面はここから選ばせ、許可リスト外の値は拒否する
export const AI_MODELS: readonly AiModel[] = [
  {
    provider: "anthropic",
    id: "claude-opus-5",
    label: "Claude Opus 5",
    pricing: "$5 / $25",
    note: "既定。行程提案の品質重視",
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    pricing: "$3 / $15",
    note: "バランス",
  },
  {
    provider: "openai",
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    pricing: "$5 / $30",
    note: "ChatGPT 側の品質重視",
  },
  {
    provider: "openai",
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    pricing: "$2 / $12",
    note: "ChatGPT 側のバランス",
  },
];

export const DEFAULT_AI_MODEL_ID = "claude-opus-5";

const AI_MODEL_SETTING_KEY = "ai_model";

const API_KEY_ENV: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** 選択中のモデル。未設定・許可リスト外(古い値)なら既定に落とす */
export function getAiModel(): AiModel {
  const row = getDb()
    .prepare("select value from app_settings where key = ?")
    .get(AI_MODEL_SETTING_KEY) as { value: string } | undefined;
  const model = AI_MODELS.find((m) => m.id === row?.value);
  return model ?? AI_MODELS.find((m) => m.id === DEFAULT_AI_MODEL_ID)!;
}

export function setAiModel(id: string): AiModel {
  const model = AI_MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`許可されていないモデルです: ${id}`);
  getDb()
    .prepare(
      `insert into app_settings (key, value, updated_at)
       values (@key, @value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       on conflict (key) do update set
         value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run({ key: AI_MODEL_SETTING_KEY, value: model.id });
  return model;
}

/** プロバイダの API キーが環境変数に設定されているか(設定画面の表示用) */
export function hasApiKey(provider: AiProvider): boolean {
  return Boolean(process.env[API_KEY_ENV[provider]]);
}

// ---- 行程提案 (/api/ai/plan) ----

export type PlanSuggestionInput = {
  departure: string;
  destination: string;
  /** YYYY-MM-DD */
  startDate: string;
  dayCount: number;
  transport: string | null;
  /** 自由記述の要望 */
  request: string | null;
};

export type SuggestedCheckpoint = {
  type: CheckpointType;
  name: string;
  note: string | null;
};

export type SuggestedDay = {
  /** YYYY-MM-DD */
  date: string;
  title: string;
  /** 大まかな地域(検索補助の入力に使う。DB には保存しない) */
  area: string;
  checkpoints: SuggestedCheckpoint[];
};

export type PlanSuggestion = { days: SuggestedDay[] };

// ---- 日数・宿泊地候補 (/api/ai/trip-outline) ----
// 旅行作成直後に、目的地と出発日時から旅行の大枠(日数と各泊の宿泊地)の候補を出す。
// 出発日時はタイムゾーン変換を避けるためクライアントのローカル日付と時刻で受ける

export type TripOutlineInput = {
  destination: string;
  /** YYYY-MM-DD(クライアントのローカル日付) */
  departureDate: string;
  /** HH:mm(クライアントのローカル時刻) */
  departureTime: string;
  /** 出発地(任意。1 日目の departure チェックポイント名) */
  departure: string | null;
  /** 出発地の座標(任意。現在地から設定した場合。地名が番地でも位置を特定できる) */
  departureLatitude: number | null;
  departureLongitude: number | null;
  transport: string | null;
  /** 自由記述の要望 */
  request: string | null;
};

export type SuggestedNight = {
  /** 宿泊する大まかな地域(例: 松本市街) */
  area: string;
  /** 宿の候補または「◯◯周辺の宿」のような検索しやすい表現 */
  name: string;
  note: string | null;
};

export type TripOutlineCandidate = {
  /** 旅行全体の日数(日帰りは 1) */
  dayCount: number;
  /** 例: 「2泊3日でゆったり」 */
  title: string;
  /** 泊数分(通常 dayCount - 1)。n 番目 = n+1 泊目 */
  nights: SuggestedNight[];
};

export type TripOutlineSuggestion = { candidates: TripOutlineCandidate[] };

// ---- 検索補助 (/api/ai/search-assist) ----

export type SearchAssistInput = {
  /** 大まかな地域(例: 松本市周辺) */
  area: string;
  /** 種別ヒント */
  type: CheckpointType | null;
  request: string | null;
};

export type SuggestedPlace = {
  name: string;
  type: CheckpointType;
  area: string;
  note: string | null;
};

export type SearchAssistSuggestion = {
  /** 地図検索にそのまま使えるクエリ候補 */
  queries: string[];
  /** 具体的な地点候補 */
  places: SuggestedPlace[];
};

// ---- 入力バリデーション(API route / Server Action 共用) ----

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAY_COUNT = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("不正な入力です");
  return value.trim() || null;
}

export function parsePlanInput(value: unknown): PlanSuggestionInput {
  if (!isRecord(value)) throw new Error("不正な入力です");
  const departure =
    typeof value.departure === "string" ? value.departure.trim() : "";
  const destination =
    typeof value.destination === "string" ? value.destination.trim() : "";
  if (!departure) throw new Error("出発地を入力してください");
  if (!destination) throw new Error("到着予定地を入力してください");
  if (typeof value.startDate !== "string" || !DATE_RE.test(value.startDate)) {
    throw new Error("開始日は YYYY-MM-DD で指定してください");
  }
  if (
    typeof value.dayCount !== "number" ||
    !Number.isInteger(value.dayCount) ||
    value.dayCount < 1 ||
    value.dayCount > MAX_DAY_COUNT
  ) {
    throw new Error(`日数は 1〜${MAX_DAY_COUNT} で指定してください`);
  }
  return {
    departure,
    destination,
    startDate: value.startDate,
    dayCount: value.dayCount,
    transport: optionalText(value.transport),
    request: optionalText(value.request),
  };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function optionalCoordinate(value: unknown, limit: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new Error("不正な座標です");
  }
  return value;
}

export function parseTripOutlineInput(value: unknown): TripOutlineInput {
  if (!isRecord(value)) throw new Error("不正な入力です");
  const destination =
    typeof value.destination === "string" ? value.destination.trim() : "";
  if (!destination) throw new Error("目的地を入力してください");
  if (
    typeof value.departureDate !== "string" ||
    !DATE_RE.test(value.departureDate)
  ) {
    throw new Error("出発日は YYYY-MM-DD で指定してください");
  }
  if (
    typeof value.departureTime !== "string" ||
    !TIME_RE.test(value.departureTime)
  ) {
    throw new Error("出発時刻は HH:mm で指定してください");
  }
  return {
    destination,
    departureDate: value.departureDate,
    departureTime: value.departureTime,
    departure: optionalText(value.departure),
    departureLatitude: optionalCoordinate(value.departureLatitude, 90),
    departureLongitude: optionalCoordinate(value.departureLongitude, 180),
    transport: optionalText(value.transport),
    request: optionalText(value.request),
  };
}

export function parseSearchAssistInput(value: unknown): SearchAssistInput {
  if (!isRecord(value)) throw new Error("不正な入力です");
  const area = typeof value.area === "string" ? value.area.trim() : "";
  if (!area) throw new Error("地域を入力してください");
  let type: CheckpointType | null = null;
  if (value.type !== undefined && value.type !== null) {
    if (
      typeof value.type !== "string" ||
      !(CHECKPOINT_TYPES as readonly string[]).includes(value.type)
    ) {
      throw new Error(`不正な種別です: ${String(value.type)}`);
    }
    type = value.type as CheckpointType;
  }
  return { area, type, request: optionalText(value.request) };
}

// ---- 出力スキーマとパース ----
// OpenAI の strict モードは全プロパティ required + additionalProperties: false が必須で
// nullable の表現もプロバイダ間で差があるため、任意項目は「空文字 = 無し」で表現し、
// パース時に null へ寄せる

const CHECKPOINT_TYPE_ENUM = [...CHECKPOINT_TYPES];

export const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    days: {
      type: "array",
      description: "開始日から日数分、連続した日付の日別行程",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          title: {
            type: "string",
            description: "その日の大まかな行程(例: 松本周辺を観光して泊)",
          },
          area: { type: "string", description: "その日の大まかな地域" },
          checkpoints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: CHECKPOINT_TYPE_ENUM },
                name: {
                  type: "string",
                  description: "地図検索でヒットしやすい具体的な施設名・地名",
                },
                note: { type: "string", description: "補足。無ければ空文字" },
              },
              required: ["type", "name", "note"],
              additionalProperties: false,
            },
          },
        },
        required: ["date", "title", "area", "checkpoints"],
        additionalProperties: false,
      },
    },
  },
  required: ["days"],
  additionalProperties: false,
};

export const TRIP_OUTLINE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      description: "日数違いの旅行の大枠候補(2〜4 件)",
      items: {
        type: "object",
        properties: {
          dayCount: {
            type: "integer",
            description: "旅行全体の日数(日帰りは 1)",
          },
          title: {
            type: "string",
            description: "候補の短い説明(例: 2泊3日でゆったり)",
          },
          nights: {
            type: "array",
            description: "泊数分(dayCount - 1)。n 番目が n 泊目",
            items: {
              type: "object",
              properties: {
                area: {
                  type: "string",
                  description: "宿泊する大まかな地域(例: 松本市街)",
                },
                name: {
                  type: "string",
                  description:
                    "宿の候補または「◯◯温泉の宿」のような地図検索でヒットしやすい表現",
                },
                note: { type: "string", description: "補足。無ければ空文字" },
              },
              required: ["area", "name", "note"],
              additionalProperties: false,
            },
          },
        },
        required: ["dayCount", "title", "nights"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

export const SEARCH_ASSIST_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      description: "地図検索にそのまま入れる短いクエリ候補",
      items: { type: "string" },
    },
    places: {
      type: "array",
      description: "条件に合う実在の具体的な地点候補",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "正式名称" },
          type: { type: "string", enum: CHECKPOINT_TYPE_ENUM },
          area: { type: "string", description: "所在地域" },
          note: { type: "string", description: "おすすめ理由など。無ければ空文字" },
        },
        required: ["name", "type", "area", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["queries", "places"],
  additionalProperties: false,
};

function isCheckpointType(value: unknown): value is CheckpointType {
  return (
    typeof value === "string" &&
    (CHECKPOINT_TYPES as readonly string[]).includes(value)
  );
}

function emptyToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** AI の応答(JSON)を検証して PlanSuggestion にする。構造が不正なら throw */
export function parsePlanSuggestion(value: unknown): PlanSuggestion {
  if (!isRecord(value) || !Array.isArray(value.days) || value.days.length === 0) {
    throw new Error("AI の応答を解釈できませんでした");
  }
  const days = value.days.map((day): SuggestedDay => {
    if (
      !isRecord(day) ||
      typeof day.date !== "string" ||
      !DATE_RE.test(day.date) ||
      typeof day.title !== "string" ||
      !day.title.trim() ||
      typeof day.area !== "string" ||
      !Array.isArray(day.checkpoints)
    ) {
      throw new Error("AI の応答を解釈できませんでした");
    }
    const checkpoints = day.checkpoints.map((c): SuggestedCheckpoint => {
      if (!isRecord(c) || typeof c.name !== "string" || !c.name.trim()) {
        throw new Error("AI の応答を解釈できませんでした");
      }
      return {
        // 許可リスト外の種別が来ても落とさず other に寄せる
        type: isCheckpointType(c.type) ? c.type : "other",
        name: c.name.trim(),
        note: emptyToNull(c.note),
      };
    });
    return {
      date: day.date,
      title: day.title.trim(),
      area: day.area.trim(),
      checkpoints,
    };
  });
  return { days };
}

/** AI の応答(JSON)を検証して TripOutlineSuggestion にする。構造が不正なら throw */
export function parseTripOutlineSuggestion(value: unknown): TripOutlineSuggestion {
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    throw new Error("AI の応答を解釈できませんでした");
  }
  const candidates = value.candidates
    .map((candidate): TripOutlineCandidate => {
      if (
        !isRecord(candidate) ||
        typeof candidate.dayCount !== "number" ||
        !Number.isInteger(candidate.dayCount) ||
        typeof candidate.title !== "string" ||
        !candidate.title.trim() ||
        !Array.isArray(candidate.nights)
      ) {
        throw new Error("AI の応答を解釈できませんでした");
      }
      const nights = candidate.nights.map((night): SuggestedNight => {
        if (!isRecord(night) || typeof night.name !== "string" || !night.name.trim()) {
          throw new Error("AI の応答を解釈できませんでした");
        }
        return {
          area: typeof night.area === "string" ? night.area.trim() : "",
          name: night.name.trim(),
          note: emptyToNull(night.note),
        };
      });
      return { dayCount: candidate.dayCount, title: candidate.title.trim(), nights };
    })
    // 現実的でない日数の候補は落とす(全滅なら下でエラー)
    .filter((c) => c.dayCount >= 1 && c.dayCount <= MAX_DAY_COUNT);
  if (candidates.length === 0) {
    throw new Error("AI から候補が得られませんでした");
  }
  return { candidates };
}

export function parseSearchAssistSuggestion(
  value: unknown,
): SearchAssistSuggestion {
  if (!isRecord(value) || !Array.isArray(value.queries) || !Array.isArray(value.places)) {
    throw new Error("AI の応答を解釈できませんでした");
  }
  const queries = value.queries
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter(Boolean);
  const places = value.places.map((p): SuggestedPlace => {
    if (!isRecord(p) || typeof p.name !== "string" || !p.name.trim()) {
      throw new Error("AI の応答を解釈できませんでした");
    }
    return {
      name: p.name.trim(),
      type: isCheckpointType(p.type) ? p.type : "other",
      area: typeof p.area === "string" ? p.area.trim() : "",
      note: emptyToNull(p.note),
    };
  });
  if (queries.length === 0 && places.length === 0) {
    throw new Error("AI から候補が得られませんでした");
  }
  return { queries, places };
}

// ---- プロンプト ----

export function buildPlanPrompt(input: PlanSuggestionInput): {
  system: string;
  user: string;
} {
  const system = [
    "あなたは旅行プランナーです。与えられた条件から旅行の日別行程を JSON で作成してください。",
    "- days は開始日から連続した日付(YYYY-MM-DD)で、必ず指定された日数分作る",
    "- 各日の title は「松本周辺を観光して泊」のような大まかな行程(地域名を含める)",
    "- 各日の checkpoints は訪問順に 2〜5 件程度",
    "- 1 日目の最初は type を departure にして出発地を、最終日の最後は type を destination にして到着予定地を入れる",
    "- 宿泊する日は最後に lodging(宿の候補または「◯◯周辺の宿」)を入れる",
    "- name は地図検索でヒットしやすい具体的な施設名・地名にする",
    "- 移動手段で現実的に回れる範囲・順序にする",
  ].join("\n");
  const user = [
    `出発地: ${input.departure}`,
    `到着予定地: ${input.destination}`,
    `開始日: ${input.startDate}`,
    `日数: ${input.dayCount}日`,
    `移動手段: ${input.transport ?? "未指定"}`,
    `要望: ${input.request ?? "特になし"}`,
  ].join("\n");
  return { system, user };
}

export function buildTripOutlinePrompt(input: TripOutlineInput): {
  system: string;
  user: string;
} {
  const system = [
    "あなたは旅行プランナーです。出発地から目的地へ向かう旅行の大枠(日数と各泊の宿泊地)の候補を JSON で作成してください。",
    "- この旅行は出発地を出発日時に出て、最終日に目的地へ到着する行程(到着後の滞在泊を含めてもよい)",
    "- 出発地と目的地が離れている場合は、移動手段で 1 日に現実的に移動できる距離を見積もり、経路上の中継地で宿泊しながら向かう(例: 車なら 1 日の運転は概ね 400〜600km。出発時刻が遅い日はさらに短く)。必要な日数を惜しまないこと",
    "- 近場なら日帰りや 1 泊の候補でよい",
    "- candidates は 2〜4 件。日数やペースの違い(最短で移動重視 / 途中の観光も楽しむ など)を出す",
    "- dayCount は旅行全体の日数(日帰りは 1)。nights は泊数分(dayCount - 1)で、n 番目が n 泊目",
    "- 各泊の area は宿泊する大まかな地域(経路上の都市・観光地)、name は「◯◯温泉の宿」「◯◯駅周辺のホテル」のような地図検索でヒットしやすい表現にする(実在が不確かな固有名は使わない)",
    "- title は「4泊5日で移動重視」のような候補の短い説明",
  ].join("\n");
  const coordinateLine =
    input.departureLatitude !== null && input.departureLongitude !== null
      ? [`出発地の座標: ${input.departureLatitude}, ${input.departureLongitude}`]
      : [];
  const user = [
    `出発地: ${input.departure ?? "未指定"}`,
    ...coordinateLine,
    `目的地: ${input.destination}`,
    `出発日時: ${input.departureDate} ${input.departureTime}`,
    `移動手段: ${input.transport ?? "未指定"}`,
    `要望: ${input.request ?? "特になし"}`,
  ].join("\n");
  return { system, user };
}

export function buildSearchAssistPrompt(input: SearchAssistInput): {
  system: string;
  user: string;
} {
  const system = [
    "あなたは旅行の地点探しを手伝うアシスタントです。大まかな地域と条件から、地図検索に使える検索クエリ候補と、具体的な地点候補を JSON で返してください。",
    "- queries は地図検索(Nominatim / Apple マップ)にそのまま入れる短いクエリを 3〜6 件(例: 「松本市 カフェ」「松本城」)",
    "- places は条件に合う実在の地点を 3〜8 件。name は正式名称にする",
    "- 実在が不確かな地点は入れない",
  ].join("\n");
  const user = [
    `地域: ${input.area}`,
    `探している種別: ${input.type ?? "指定なし"}`,
    `条件・要望: ${input.request ?? "特になし"}`,
  ].join("\n");
  return { system, user };
}

// ---- プロバイダ呼び出し ----

const MAX_OUTPUT_TOKENS = 16000;

async function completeJson(
  prompt: { system: string; user: string },
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<unknown> {
  const model = getAiModel();
  const envName = API_KEY_ENV[model.provider];
  const apiKey = process.env[envName];
  if (!apiKey) {
    throw new Error(
      `${model.label} を使うには環境変数 ${envName} の設定が必要です`,
    );
  }
  let text: string;
  try {
    if (model.provider === "anthropic") {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: model.id,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        output_config: { format: { type: "json_schema", schema } },
      });
      if (response.stop_reason === "refusal") {
        throw new Error("モデルが応答を拒否しました");
      }
      text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    } else {
      const client = new OpenAI({ apiKey });
      const response = await client.responses.create({
        model: model.id,
        instructions: prompt.system,
        input: prompt.user,
        text: {
          format: { type: "json_schema", name: schemaName, strict: true, schema },
        },
      });
      text = response.output_text;
    }
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI (${model.label}) の呼び出しに失敗しました: ${message}`);
  }
}

export async function suggestPlan(
  input: PlanSuggestionInput,
): Promise<PlanSuggestion> {
  const raw = await completeJson(buildPlanPrompt(input), "plan", PLAN_SCHEMA);
  return parsePlanSuggestion(raw);
}

export async function suggestTripOutline(
  input: TripOutlineInput,
): Promise<TripOutlineSuggestion> {
  const raw = await completeJson(
    buildTripOutlinePrompt(input),
    "trip_outline",
    TRIP_OUTLINE_SCHEMA,
  );
  return parseTripOutlineSuggestion(raw);
}

export async function searchAssist(
  input: SearchAssistInput,
): Promise<SearchAssistSuggestion> {
  const raw = await completeJson(
    buildSearchAssistPrompt(input),
    "search_assist",
    SEARCH_ASSIST_SCHEMA,
  );
  return parseSearchAssistSuggestion(raw);
}
