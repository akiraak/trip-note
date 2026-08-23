import type { CheckpointType } from "./types";

// AI の日数・宿泊地候補のプレビュー地図に載せる点列。
// iOS の TripCreateView.mapPoints(for:departure:...) と同じ順序・規則:
// 出発地 → 各泊 → 目的地 で、座標が無い点は飛ばす。
// 座標はいずれも概算(出発地はリンクから取れたときだけ)なのでおおよその位置

export type OutlineMapPoint = {
  /** マーカーの吹き出し・title に出すラベル(例: 「1泊目 松本市街」) */
  label: string;
  /** マーカーの色分けに使う(departure / lodging / destination のみ) */
  type: CheckpointType;
  latitude: number;
  longitude: number;
};

export type OutlineMapNight = {
  /** 宿泊する大まかな地域(例: 松本市街) */
  area: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
};

type Place = {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** 座標が両方そろっているときだけ返す(片方だけなら捨てる) */
function coordinate(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number; longitude: number } | null {
  return typeof latitude === "number" && typeof longitude === "number"
    ? { latitude, longitude }
    : null;
}

export function outlineMapPoints({
  departure,
  nights,
  destination,
}: {
  departure: Place | null;
  nights: OutlineMapNight[];
  destination: Place | null;
}): OutlineMapPoint[] {
  const points: OutlineMapPoint[] = [];
  const start = departure && coordinate(departure.latitude, departure.longitude);
  if (start) {
    points.push({
      label: departure?.name?.trim() || "出発",
      type: "departure",
      ...start,
    });
  }
  nights.forEach((night, index) => {
    const at = coordinate(night.latitude, night.longitude);
    if (!at) return;
    const area = night.area.trim() || night.name.trim();
    points.push({ label: `${index + 1}泊目 ${area}`.trim(), type: "lodging", ...at });
  });
  const goal = destination && coordinate(destination.latitude, destination.longitude);
  if (goal) {
    points.push({
      label: destination?.name?.trim() || "目的地",
      type: "destination",
      ...goal,
    });
  }
  return points;
}
