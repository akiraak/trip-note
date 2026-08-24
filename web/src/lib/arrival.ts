import { isDegenerate, legKey, type ResolvedLeg, type RoutePoint } from "./route-legs";

// 日単位の出発時刻とレグ所要時間(OSRM の durationS)から、各チェックポイントの
// 到着予想時刻を導出する純ロジック。iOS の Domain/ArrivalEstimator.swift と同じ規約。
// 予想は保存せず表示時に計算する(planned_time へ書き込むと updated_at が動いて
// LWW と同期を乱すため)。DB に触れないのでクライアントコンポーネントからも使える。
//
// タイムゾーンは予定時刻(planned_time)の表示・入力と同じくブラウザのローカル TZ
// (iOS の「端末の Calendar 基準」と同じ扱い)。

/** 到着予想の入力になるチェックポイント(sort_order 順・tombstone 除外済みの前提) */
export type ArrivalCheckpoint = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  /** 手入力の予定時刻(ISO)。あるとそこで再アンカーする */
  planned_time: string | null;
};

/// "HH:MM" の出発時刻を日付(YYYY-MM-DD)と合成して Date にする。
/// planned_time と同じ基準で比較・連鎖できるようローカル TZ で解釈する
export function departureDateTime(
  dayDate: string,
  departureTime: string | null,
): Date | null {
  if (!departureTime) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) return null;
  const parts = /^(\d{2}):(\d{2})$/.exec(departureTime);
  if (!parts) return null;
  const hour = Number(parts[1]);
  const minute = Number(parts[2]);
  if (hour > 23 || minute > 59) return null;
  // Z を付けない = ローカル TZ の壁時計として解釈される
  const date = new Date(`${dayDate}T${parts[1]}:${parts[2]}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ISO の予定時刻。読めない値は「予定時刻なし」として扱う */
function parsePlannedTime(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/// checkpoints(訪問順)の到着予想時刻を CP id で返す。
/// 手入力 planned_time のある CP は対象外(表示はそのまま planned_time を使う)。
/// 規則(iOS の ArrivalEstimator.estimates と同じ):
/// - anchor は日の出発時刻(前泊地を出る時刻)から始まり、planned_time のある CP で
///   その値に置き換えて再連鎖する(滞在時間はモデル化せず「その CP を出る時刻」扱い。
///   1 日目は出発 CP の planned_time = trip.departure_at が自然に anchor になる)
/// - 各 CP の予想 = anchor + anchor 以降のレグ所要時間(durationS)の累積
/// - anchor が無い区間と未解決レグ(durationS 不明)以降は予想なし
///   (次の planned_time 付き CP で再開する)
/// - 座標なし CP は予想なし。レグは buildLegs と同様にそれを飛ばして連鎖を続ける
export function arrivalEstimates({
  dayDate,
  departureTime,
  routeStart = null,
  checkpoints,
  resolved,
}: {
  dayDate: string;
  departureTime: string | null;
  /** ルートの起点(前泊地など)。無ければ null */
  routeStart?: RoutePoint | null;
  checkpoints: ArrivalCheckpoint[];
  /** レグキー → 解決済みレグ(useRouteLegs の戻り値) */
  resolved: Record<string, ResolvedLeg>;
}): Record<string, Date> {
  let anchor = departureDateTime(dayDate, departureTime);
  let accumulatedS = 0;
  let previous = routeStart;
  const estimates: Record<string, Date> = {};

  for (const checkpoint of checkpoints) {
    const { latitude, longitude } = checkpoint;
    const coordinate: RoutePoint | null =
      latitude === null || longitude === null ? null : { latitude, longitude };
    if (coordinate) {
      if (previous) {
        const leg = { from: previous, to: coordinate };
        if (isDegenerate(leg)) {
          // 丸め粒度で同一地点(レグ組み立てでも作られない)。所要 0 で連鎖を続ける
        } else {
          const hit = resolved[legKey(leg.from, leg.to)];
          if (hit) {
            accumulatedS += hit.durationS;
          } else {
            // 未解決レグ以降は予想を打ち切る(次の planned_time で再アンカー)
            anchor = null;
          }
        }
      }
      previous = coordinate;
    }
    const plannedTime = parsePlannedTime(checkpoint.planned_time);
    if (plannedTime) {
      anchor = plannedTime;
      accumulatedS = 0;
    } else if (coordinate && anchor) {
      estimates[checkpoint.id] = new Date(anchor.getTime() + accumulatedS * 1000);
    }
  }
  return estimates;
}
