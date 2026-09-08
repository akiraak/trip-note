"use client";

import { useMemo } from "react";
import { arrivalEstimates } from "@/lib/arrival";
import { CHECKPOINT_COLORS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { formatDayWithWeekday, formatLocalTime } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { googleMapsSearchUrl } from "@/lib/google-maps";
import { dayMapPoints, type DayMapData } from "@/lib/plan-map";
import { buildLegs, totalLegMeters, type ResolvedLeg } from "@/lib/route-legs";
import type { PlanCheckpoint, PlanDay } from "@/lib/trip-plan";

// 共有ページのプラン(日別)表示。旅行詳細の日カード(trips/[id]/plan-section.tsx の DayCard)と
// 同じ情報を出す閲覧専用版。編集・削除・追加の導線は持たない。
// 道路形状レグは SSR で渡されたキャッシュ済みの分だけ使い、未解決は直線距離のまま
// (公開経路から Server Action を呼ばせない)。文言・空状態は旅行詳細と揃える

export function SharePlan({
  days,
  resolved,
  selectedDayId,
  onSelectDay,
}: {
  days: PlanDay[];
  /** キャッシュ済みの道路形状レグ */
  resolved: Record<string, ResolvedLeg>;
  selectedDayId: string | null;
  onSelectDay: (dayId: string | null) => void;
}) {
  // 日ごとのルート(前泊地起点)。走行距離・到着予想の計算に使う
  const maps = useMemo(() => dayMapPoints(days), [days]);

  return (
    <div className="flex flex-col gap-3">
      {days.length === 0 && (
        <p className="text-sm text-muted">プランはまだありません</p>
      )}
      {days.map((day, index) => (
        <ShareDayCard
          key={day.id}
          day={day}
          dayNumber={index + 1}
          map={maps[index]}
          resolved={resolved}
          selected={selectedDayId === day.id}
          onSelect={() =>
            onSelectDay(selectedDayId === day.id ? null : day.id)
          }
        />
      ))}
    </div>
  );
}

function ShareDayCard({
  day,
  dayNumber,
  map,
  resolved,
  selected,
  onSelect,
}: {
  day: PlanDay;
  dayNumber: number;
  map: DayMapData;
  resolved: Record<string, ResolvedLeg>;
  selected: boolean;
  onSelect: () => void;
}) {
  // 前泊地を起点にした、その日のレグ列
  const legs = useMemo(
    () => buildLegs({ start: map.anchor, points: map.points }),
    [map],
  );
  // 走行距離は解決済みレグが道路距離・未解決レグが直線距離の概算なので常に「約」
  const distanceMeters = totalLegMeters(legs, resolved);
  // 到着予想(出発時刻 + 解決済みレグの所要時間)。予定時刻が手入力されている CP には出ない
  const estimates = useMemo(
    () =>
      arrivalEstimates({
        dayDate: day.date,
        departureTime: day.departure_time,
        routeStart: map.anchor,
        checkpoints: day.checkpoints,
        resolved,
      }),
    [day.date, day.departure_time, day.checkpoints, map.anchor, resolved],
  );
  // 経由地は座標の有無に関わらず訪問順に全部並べる
  const waypoints = day.checkpoints.map((c) => c.name).join(" → ");

  return (
    <section
      className={`rounded-lg border ${
        selected ? "border-accent bg-raised" : "border-border bg-surface"
      }`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onSelect}
          className="flex items-center gap-2 text-left"
          title={selected ? "地図の絞り込みを外す" : "この日を地図で見る"}
        >
          <span className="font-medium">{dayNumber}日目</span>
          <span className="tabular text-xs text-muted">
            {formatDayWithWeekday(day.date)}
          </span>
        </button>
        {day.departure_time && (
          <span className="tabular shrink-0 text-xs text-muted">
            出発 {day.departure_time}
          </span>
        )}
        {distanceMeters > 0 && (
          <span className="tabular shrink-0 text-xs text-muted">
            <span aria-hidden>🚗</span> 約 {formatDistance(distanceMeters)}
          </span>
        )}
      </header>
      <div className="flex flex-col gap-2 p-3">
        {day.title && <p className="text-sm">{day.title}</p>}
        {waypoints && (
          <p className="line-clamp-2 text-sm text-muted">{waypoints}</p>
        )}
        {day.note && (
          <p className="text-sm whitespace-pre-wrap text-muted">{day.note}</p>
        )}
        {day.checkpoints.length === 0 && (
          <p className="text-sm text-muted">チェックポイントなし</p>
        )}
        {day.checkpoints.length > 0 && (
          <ol className="flex flex-col gap-1">
            {day.checkpoints.map((checkpoint) => (
              <ShareCheckpointRow
                key={checkpoint.id}
                checkpoint={checkpoint}
                estimatedArrival={estimates[checkpoint.id]}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function ShareCheckpointRow({
  checkpoint,
  estimatedArrival,
}: {
  checkpoint: PlanCheckpoint;
  /** 到着予想時刻(手入力の予定時刻がある CP は予想を出さず予定時刻を表示する) */
  estimatedArrival?: Date;
}) {
  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-1 text-sm">
      {/* 地図のピンと同じ種別色の点で結びつける */}
      <span
        aria-hidden
        className="mt-1.5 size-2.5 shrink-0 rounded-full"
        style={{ background: CHECKPOINT_COLORS[checkpoint.type] }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{checkpoint.name}</span>
        <span className="tabular flex flex-wrap items-baseline gap-2 text-xs text-muted">
          <span>{CHECKPOINT_LABELS[checkpoint.type]}</span>
          {/* 予定時刻・到着予想はブラウザのローカル TZ で表示する(SSR とはずれ得るので警告を抑止) */}
          {checkpoint.planned_time ? (
            <span suppressHydrationWarning>
              {formatLocalTime(new Date(checkpoint.planned_time))}
            </span>
          ) : (
            estimatedArrival && (
              <span suppressHydrationWarning>
                {formatLocalTime(estimatedArrival)} 頃
              </span>
            )
          )}
          {checkpoint.latitude === null && <span>座標未設定</span>}
        </span>
        {checkpoint.note && (
          <span className="block truncate text-xs text-muted">
            {checkpoint.note}
          </span>
        )}
      </span>
      {checkpoint.latitude !== null && checkpoint.longitude !== null && (
        <a
          href={googleMapsSearchUrl(checkpoint.latitude, checkpoint.longitude)}
          target="_blank"
          rel="noreferrer"
          title="Google Maps で開く"
          className="shrink-0 text-xs text-accent hover:underline"
        >
          地図↗
        </a>
      )}
    </li>
  );
}
