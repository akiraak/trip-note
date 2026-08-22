import type { CheckpointType } from "./types";

// チェックポイント種別の表示定義。リスト行と地図ピンで共通に使う
// (iOS 側 ios/TripNote/Views/CheckpointStyle.swift と対応)

export const CHECKPOINT_LABELS: Record<CheckpointType, string> = {
  departure: "出発地",
  destination: "到着予定地",
  sightseeing: "観光",
  cafe: "カフェ",
  restaurant: "食事",
  lodging: "宿泊",
  other: "その他",
};

export const CHECKPOINT_ICONS: Record<CheckpointType, string> = {
  departure: "🚩",
  destination: "🏁",
  sightseeing: "🔭",
  cafe: "☕️",
  restaurant: "🍽️",
  lodging: "🛏️",
  other: "📍",
};

// 地図ピンの色(iOS の tint と対応させる)
export const CHECKPOINT_COLORS: Record<CheckpointType, string> = {
  departure: "#16a34a", // green-600
  destination: "#dc2626", // red-600
  sightseeing: "#ea580c", // orange-600
  cafe: "#a16207", // yellow-700 (brown 相当)
  restaurant: "#db2777", // pink-600
  lodging: "#4f46e5", // indigo-600
  other: "#71717a", // zinc-500
};

export const TRANSPORT_LABELS: Record<string, string> = {
  car: "車",
  train: "電車",
  walk: "徒歩",
  bicycle: "自転車",
  mixed: "混合",
};

export function transportLabel(transport: string | null): string | null {
  if (!transport) return null;
  return TRANSPORT_LABELS[transport] ?? transport;
}
