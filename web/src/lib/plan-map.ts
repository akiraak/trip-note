import type { CheckpointType } from "./types";

// 日別プラン地図に載せるデータの組み立て。
// iOS の DayRoute.anchor(before:in:) / TripDetailView.routeAnchor と同じ規則:
// その日の座標ありチェックポイントを訪問順に並べ、ルートの起点は
// 「それより前の日の最後の座標ありチェックポイント」(= 前泊地)にする。

export type Coordinate = { latitude: number; longitude: number };

/** 日別地図のマーカー 1 件 */
export type DayMapPoint = Coordinate & {
  id: string;
  type: CheckpointType;
  name: string;
};

/** 1 日分の地図データ */
export type DayMapData = {
  /** その日の座標ありチェックポイント(日内の順序のまま) */
  points: DayMapPoint[];
  /** ルートの起点(前泊地など)。前の日に座標ありが無ければ null */
  anchor: Coordinate | null;
};

type SourceCheckpoint = {
  id: string;
  type: CheckpointType;
  name: string;
  latitude: number | null;
  longitude: number | null;
};

/** tombstone は呼び出し側(page.tsx の SQL)で除外済みの前提 */
type SourceDay = { checkpoints: SourceCheckpoint[] };

/** 座標が両方そろっているチェックポイントだけを訪問順のまま残す */
function locatedPoints(day: SourceDay): DayMapPoint[] {
  const points: DayMapPoint[] = [];
  for (const checkpoint of day.checkpoints) {
    const { latitude, longitude } = checkpoint;
    // 片方だけ・null のものは黙って飛ばす(地図に置きようがないため)
    if (latitude === null || longitude === null) continue;
    points.push({
      id: checkpoint.id,
      type: checkpoint.type,
      name: checkpoint.name,
      latitude,
      longitude,
    });
  }
  return points;
}

/** 日ごとの地図データ(days と同じ順序・同じ件数で返す) */
export function dayMapPoints(days: SourceDay[]): DayMapData[] {
  const perDay = days.map(locatedPoints);
  return perDay.map((points, index) => {
    // 前の日を逆順に見て、最初に見つかった日の最後の点を起点にする
    let anchor: Coordinate | null = null;
    for (let i = index - 1; i >= 0; i--) {
      const previous = perDay[i];
      if (previous.length > 0) {
        const last = previous[previous.length - 1];
        anchor = { latitude: last.latitude, longitude: last.longitude };
        break;
      }
    }
    return { points, anchor };
  });
}
