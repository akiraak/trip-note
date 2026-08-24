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

// 地図ピン・一覧の点の色(iOS の CheckpointType.tint と同じ値)。
// 暗い地図・パネルの上で読める彩度に寄せてある
export const CHECKPOINT_COLORS: Record<CheckpointType, string> = {
  departure: "#7BD389",
  destination: "#FF7C6B",
  sightseeing: "#F2A03D",
  cafe: "#C99B6A",
  restaurant: "#F274A6",
  lodging: "#8CA0FF",
  other: "#93A0AE",
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
