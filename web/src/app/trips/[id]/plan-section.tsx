"use client";

import { useMemo, useState, useTransition } from "react";
import {
  addCheckpointAction,
  addDayAction,
  deleteCheckpointAction,
  deleteDayAction,
  insertDayAfterAction,
  moveCheckpointAction,
  updateCheckpointAction,
  updateDayAction,
  type ActionResult,
} from "./actions";
import { AiPlanSuggest } from "./ai-plan";
import { CheckpointForm } from "./checkpoint-form";
import { PlaceLink } from "./place-link";
import { useRouteLegs } from "./use-route-legs";
import { CHECKPOINT_COLORS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { formatDayWithWeekday } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { googleMapsSearchUrl } from "@/lib/google-maps";
import { dayMapPoints, type DayMapData } from "@/lib/plan-map";
import { buildLegs, totalLegMeters, type ResolvedLeg } from "@/lib/route-legs";
import type { CheckpointType } from "@/lib/types";

// 旅行詳細のプラン(日別)表示・編集。データは server component (page.tsx) から
// 受け取り、変更は Server Actions 経由。アクションが revalidatePath するので
// 完了後は新しい props が流れてくる(クライアント側でリストの複製は持たない)。
// 地図は画面いっぱいの 1 枚(TripMap)に集約したので、日カードにミニ地図は持たない。
// 代わりに日の見出しを押すとその日へ地図が寄る

export type PlanCheckpoint = {
  id: string;
  type: CheckpointType;
  name: string;
  latitude: number | null;
  longitude: number | null;
  planned_time: string | null;
  note: string | null;
};

export type PlanDay = {
  id: string;
  date: string;
  title: string | null;
  note: string | null;
  /** 前泊地を出発する時刻 "HH:MM"(iOS で設定して同期されてくる) */
  departure_time: string | null;
  checkpoints: PlanCheckpoint[];
};

export function PlanSection({
  tripId,
  days,
  transport,
  aiDefaults,
  cachedLegs,
  selectedDayId,
  onSelectDay,
}: {
  tripId: string;
  days: PlanDay[];
  transport: string | null;
  /** AI 提案フォームの初期値(page.tsx で計算) */
  aiDefaults: { startDate: string; dayCount: number; departure: string };
  /** SSR 時点でキャッシュ済みだったレグ(page.tsx の readCachedLegs) */
  cachedLegs?: Record<string, ResolvedLeg>;
  /** 地図が寄っている日 */
  selectedDayId?: string | null;
  onSelectDay?: (dayId: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  // 日ごとのルート(前泊地起点)。走行距離の計算に使う
  const maps = useMemo(() => dayMapPoints(days), [days]);

  // Server Action を実行し、成功したらフォームを閉じるなどの後処理を行う
  const run = (action: () => Promise<ActionResult>, onSuccess?: () => void) => {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        onSuccess?.();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {days.length === 0 && (
        <p className="text-sm text-muted">プランはまだありません</p>
      )}
      {days.map((day, index) => (
        <DayCard
          key={day.id}
          day={day}
          dayNumber={index + 1}
          isLast={index === days.length - 1}
          map={maps[index]}
          cachedLegs={cachedLegs}
          pending={pending}
          run={run}
          selected={selectedDayId === day.id}
          onSelect={() =>
            onSelectDay?.(selectedDayId === day.id ? null : day.id)
          }
        />
      ))}
      {aiOpen && (
        <AiPlanSuggest
          tripId={tripId}
          transport={transport}
          defaultStartDate={aiDefaults.startDate}
          defaultDayCount={aiDefaults.dayCount}
          defaultDeparture={aiDefaults.departure}
          onDone={() => setAiOpen(false)}
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => addDayAction(tripId))}
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-raised disabled:opacity-50"
        >
          + 日を追加
        </button>
        {!aiOpen && (
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-raised"
          >
            ✨ AI で行程を提案
          </button>
        )}
      </div>
    </div>
  );
}

type RunAction = (
  action: () => Promise<ActionResult>,
  onSuccess?: () => void,
) => void;

function DayCard({
  day,
  dayNumber,
  isLast,
  map,
  cachedLegs,
  pending,
  run,
  selected,
  onSelect,
}: {
  day: PlanDay;
  dayNumber: number;
  /** 最終日(削除・日の差し込みで後続がずれない)か */
  isLast: boolean;
  /** この日のルート(前泊地起点)。走行距離に使う */
  map: DayMapData;
  cachedLegs?: Record<string, ResolvedLeg>;
  pending: boolean;
  run: RunAction;
  selected: boolean;
  onSelect: () => void;
}) {
  // 同時に開くフォームは日ごとに 1 つ
  const [mode, setMode] = useState<
    null | "edit-day" | "add-link" | "add-manual"
  >(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(
    null,
  );
  // 前泊地を起点にした、その日のレグ列
  const legs = useMemo(
    () => buildLegs({ start: map.anchor, points: map.points }),
    [map],
  );
  const resolved = useRouteLegs(legs, cachedLegs);
  // 走行距離は解決済みレグが道路距離・未解決レグが直線距離の概算なので常に「約」
  // (iOS の TripDayRow と同じ)
  const distanceMeters = totalLegMeters(legs, resolved);
  // 経由地は座標の有無に関わらず訪問順に全部並べる(iOS の TripDayRow と同じ)
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
        {/* 前泊地を出発する時刻(iOS の日詳細「出発時刻」) */}
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
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode(mode === "edit-day" ? null : "edit-day")}
            className="text-accent hover:underline"
          >
            編集
          </button>
          {confirmingDelete ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => deleteDayAction(day.id),
                    () => setConfirmingDelete(false),
                  )
                }
                className="font-medium text-danger underline disabled:opacity-50"
              >
                本当に削除する
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="hover:underline"
              >
                やめる
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-danger hover:underline"
            >
              削除
            </button>
          )}
        </span>
      </header>
      <div className="flex flex-col gap-2 p-3">
        {day.title && <p className="text-sm">{day.title}</p>}
        {/* 経由地(訪問順に名前を繋いだ概要。iOS の TripDayRow と同じく 2 行でクランプ) */}
        {waypoints && (
          <p className="line-clamp-2 text-sm text-muted">{waypoints}</p>
        )}
        {day.note && !confirmingDelete && mode !== "edit-day" && (
          <p className="text-sm whitespace-pre-wrap text-muted">{day.note}</p>
        )}
        {confirmingDelete && (
          <p className="text-sm text-danger">
            この日とチェックポイント {day.checkpoints.length} 件を削除します
            {!isLast && "。以降の日は 1 日前にずれます"}
          </p>
        )}
        {mode === "edit-day" && (
          <DayForm
            day={day}
            pending={pending}
            onSubmit={(fields) =>
              run(
                () => updateDayAction(day.id, fields),
                () => setMode(null),
              )
            }
            onCancel={() => setMode(null)}
          />
        )}
        {day.checkpoints.length === 0 && (
          <p className="text-sm text-muted">チェックポイントなし</p>
        )}
        {day.checkpoints.length > 0 && (
          <ol className="flex flex-col gap-1">
            {day.checkpoints.map((checkpoint, index) =>
              editingCheckpointId === checkpoint.id ? (
                <li key={checkpoint.id}>
                  <CheckpointForm
                    initial={checkpoint}
                    pending={pending}
                    submitLabel="保存"
                    onSubmit={(input) =>
                      run(
                        () => updateCheckpointAction(checkpoint.id, input),
                        () => setEditingCheckpointId(null),
                      )
                    }
                    onCancel={() => setEditingCheckpointId(null)}
                  />
                </li>
              ) : (
                <CheckpointRow
                  key={checkpoint.id}
                  checkpoint={checkpoint}
                  isFirst={index === 0}
                  isLast={index === day.checkpoints.length - 1}
                  pending={pending}
                  run={run}
                  onEdit={() => setEditingCheckpointId(checkpoint.id)}
                />
              ),
            )}
          </ol>
        )}
        {mode === "add-link" && (
          <PlaceLink
            selectLabel="追加"
            allowsMissingCoordinate
            disabled={pending}
            onSelect={(place) =>
              run(() =>
                addCheckpointAction(day.id, {
                  type: "sightseeing",
                  name: place.name,
                  latitude: place.latitude,
                  longitude: place.longitude,
                  planned_time: null,
                  note: null,
                }),
              )
            }
          />
        )}
        {mode === "add-manual" && (
          <CheckpointForm
            initial={null}
            pending={pending}
            submitLabel="追加"
            onSubmit={(input) =>
              run(
                () => addCheckpointAction(day.id, input),
                () => setMode(null),
              )
            }
            onCancel={() => setMode(null)}
          />
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <button
            type="button"
            onClick={() => setMode(mode === "add-link" ? null : "add-link")}
            className="text-accent hover:underline"
          >
            {mode === "add-link"
              ? "リンク入力を閉じる"
              : "+ Google Maps のリンクから追加"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "add-manual" ? null : "add-manual")}
            className="text-accent hover:underline"
          >
            {mode === "add-manual" ? "テキスト入力を閉じる" : "+ テキストを追加"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => insertDayAfterAction(day.id))}
            className="ml-auto text-accent hover:underline disabled:opacity-50"
            title={
              isLast
                ? "末尾に日を追加します"
                : "以降の日は 1 日ずつ後ろへずれます"
            }
          >
            + この日の後に日を追加
          </button>
        </div>
      </div>
    </section>
  );
}

function DayForm({
  day,
  pending,
  onSubmit,
  onCancel,
}: {
  day: PlanDay;
  pending: boolean;
  onSubmit: (fields: {
    title: string | null;
    note: string | null;
    departure_time: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(day.title ?? "");
  const [note, setNote] = useState(day.note ?? "");
  // 空 = 未設定(iOS の Toggle + DatePicker と同じ意味を素の input で表す)
  const [departureTime, setDepartureTime] = useState(day.departure_time ?? "");
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          title: title || null,
          note: note || null,
          departure_time: departureTime || null,
        });
      }}
    >
      <input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="タイトル(例: 松本周辺を観光して泊)"
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="メモ"
        rows={2}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
      />
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">出発時刻</span>
        <input
          type="time"
          value={departureTime}
          onChange={(event) => setDepartureTime(event.target.value)}
          className="tabular rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <span className="text-xs text-muted">
          この日の宿泊地(前泊地)を出発する時刻。空にすると未設定
        </span>
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-raised"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}

function CheckpointRow({
  checkpoint,
  isFirst,
  isLast,
  pending,
  run,
  onEdit,
}: {
  checkpoint: PlanCheckpoint;
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  run: RunAction;
  onEdit: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-raised">
      {/* 地図のピンと同じ種別色の点で結びつける(iOS の CheckpointRow と同じ) */}
      <span
        aria-hidden
        className="mt-1.5 size-2.5 shrink-0 rounded-full"
        style={{ background: CHECKPOINT_COLORS[checkpoint.type] }}
      />
      {/* 名前の下に「種別 · 予定時刻 · 座標未設定」を並べる */}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{checkpoint.name}</span>
        <span className="tabular flex flex-wrap items-baseline gap-2 text-xs text-muted">
          <span>{CHECKPOINT_LABELS[checkpoint.type]}</span>
          {checkpoint.planned_time && (
            // 予定時刻はブラウザのローカル TZ で表示する(SSR とはずれ得るので警告を抑止)
            <span suppressHydrationWarning>
              {new Date(checkpoint.planned_time).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {checkpoint.latitude === null && <span>座標未設定</span>}
        </span>
        {checkpoint.note && (
          <span className="block truncate text-xs text-muted">
            {checkpoint.note}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs">
        {checkpoint.latitude !== null && checkpoint.longitude !== null && (
          <a
            href={googleMapsSearchUrl(checkpoint.latitude, checkpoint.longitude)}
            target="_blank"
            rel="noreferrer"
            title="Google Maps で開く"
            className="mr-1 text-accent hover:underline"
          >
            地図↗
          </a>
        )}
        <button
          type="button"
          disabled={pending || isFirst}
          onClick={() => run(() => moveCheckpointAction(checkpoint.id, -1))}
          className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30"
          aria-label="上へ"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={pending || isLast}
          onClick={() => run(() => moveCheckpointAction(checkpoint.id, 1))}
          className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30"
          aria-label="下へ"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="ml-1 text-accent hover:underline"
        >
          編集
        </button>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteCheckpointAction(checkpoint.id))}
              className="font-medium text-danger underline disabled:opacity-50"
            >
              本当に削除する
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="hover:underline"
            >
              やめる
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-danger hover:underline"
          >
            削除
          </button>
        )}
      </span>
    </li>
  );
}
