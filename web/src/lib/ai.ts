import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getDb } from "./db";

// AI 提案の共通ロジック。プロバイダは Claude (Anthropic API) と
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
  /** 地域の概算座標(候補プレビュー地図専用。チェックポイントには保存しない) */
  latitude: number | null;
  longitude: number | null;
};

export type TripOutlineCandidate = {
  /** 旅行全体の日数(日帰りは 1) */
  dayCount: number;
  /** 例: 「2泊3日でゆったり」 */
  title: string;
  /** 泊数分(通常 dayCount - 1)。n 番目 = n+1 泊目 */
  nights: SuggestedNight[];
};

export type TripOutlineSuggestion = {
  candidates: TripOutlineCandidate[];
  /** 目的地の概算座標(候補共通。最終日の destination チェックポイントに使う) */
  destinationLatitude: number | null;
  destinationLongitude: number | null;
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

// ---- 出力スキーマとパース ----
// OpenAI の strict モードは全プロパティ required + additionalProperties: false が必須で
// nullable の表現もプロバイダ間で差があるため、任意項目は「空文字 = 無し」で表現し、
// パース時に null へ寄せる

export const TRIP_OUTLINE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    destinationLatitude: {
      type: "number",
      description: "目的地の概算緯度(市レベルの精度でよい)",
    },
    destinationLongitude: {
      type: "number",
      description: "目的地の概算経度",
    },
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
                latitude: {
                  type: "number",
                  description: "地域の概算緯度(プレビュー地図用。市レベルの精度でよい)",
                },
                longitude: {
                  type: "number",
                  description: "地域の概算経度",
                },
              },
              required: ["area", "name", "note", "latitude", "longitude"],
              additionalProperties: false,
            },
          },
        },
        required: ["dayCount", "title", "nights"],
        additionalProperties: false,
      },
    },
  },
  required: ["destinationLatitude", "destinationLongitude", "candidates"],
  additionalProperties: false,
};

function emptyToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 表示専用の座標。数値でない・範囲外なら null(エラーにしない) */
function displayCoordinate(value: unknown, limit: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= limit
    ? value
    : null;
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
          // プレビュー地図専用の概算座標。不正でも候補ごと落とさず null に寄せる
          latitude: displayCoordinate(night.latitude, 90),
          longitude: displayCoordinate(night.longitude, 180),
        };
      });
      return { dayCount: candidate.dayCount, title: candidate.title.trim(), nights };
    })
    // 現実的でない日数の候補は落とす(全滅なら下でエラー)
    .filter((c) => c.dayCount >= 1 && c.dayCount <= MAX_DAY_COUNT);
  if (candidates.length === 0) {
    throw new Error("AI から候補が得られませんでした");
  }
  // 目的地の概算座標(片方だけなら両方捨てる)
  let destinationLatitude = displayCoordinate(value.destinationLatitude, 90);
  let destinationLongitude = displayCoordinate(value.destinationLongitude, 180);
  if (destinationLatitude === null || destinationLongitude === null) {
    destinationLatitude = null;
    destinationLongitude = null;
  }
  return { candidates, destinationLatitude, destinationLongitude };
}

// ---- プロンプト ----

export function buildTripOutlinePrompt(input: TripOutlineInput): {
  system: string;
  user: string;
} {
  const system = [
    "あなたは旅行プランナーです。出発地から目的地へ向かう旅行の大枠(日数と各泊の宿泊地)の候補を JSON で作成してください。",
    "- この旅行は出発地を出発日時に出て、最終日に目的地へ到着する行程(到着後の滞在泊を含めてもよい)",
    "- 出発地が「未指定」の場合は、出発都市を勝手に仮定せず目的地周辺で完結する行程にする",
    "- 出発地と目的地が離れている場合は、移動手段で 1 日に現実的に移動できる距離を見積もり、経路上の中継地で宿泊しながら向かう(例: 車なら 1 日の運転は概ね 400〜600km。出発時刻が遅い日はさらに短く)。必要な日数を惜しまないこと",
    "- 近場なら日帰りや 1 泊の候補でよい",
    "- candidates は 2〜4 件。日数やペースの違い(最短で移動重視 / 途中の観光も楽しむ など)を出す",
    "- dayCount は旅行全体の日数(日帰りは 1)。nights は泊数分(dayCount - 1)で、n 番目が n 泊目",
    "- 各泊の area は宿泊する大まかな地域(経路上の都市・観光地)、name は「◯◯温泉の宿」「◯◯駅周辺のホテル」のような地図検索でヒットしやすい表現にする(実在が不確かな固有名は使わない)",
    "- 各泊の latitude / longitude はその地域の概算座標(市レベルの精度でよい)。destinationLatitude / destinationLongitude には目的地の概算座標を入れる",
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
