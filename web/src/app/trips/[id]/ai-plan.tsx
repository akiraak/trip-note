"use client";

import { useState, useTransition } from "react";
import { adoptPlanAction, suggestPlanAction } from "./actions";
import type { PlanSuggestion } from "@/lib/ai";
import { CHECKPOINT_ICONS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { formatDay } from "@/lib/format";

// AI 行程提案。条件フォーム → 提案のプレビュー → 採用(trip_days / checkpoints 作成)。
// 提案は DB に書かず、採用を押したときだけ adoptPlanAction で書き込む

export function AiPlanSuggest({
  tripId,
  transport,
  defaultStartDate,
  defaultDayCount,
  onDone,
}: {
  tripId: string;
  transport: string | null;
  defaultStartDate: string;
  defaultDayCount: number;
  onDone: () => void;
}) {
  const [departure, setDeparture] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [dayCount, setDayCount] = useState(defaultDayCount);
  const [request, setRequest] = useState("");
  const [suggestion, setSuggestion] = useState<PlanSuggestion | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function suggest() {
    setError(null);
    startTransition(async () => {
      const result = await suggestPlanAction({
        departure,
        destination,
        startDate,
        dayCount,
        transport,
        request: request || null,
      });
      if (result.ok) {
        setSuggestion(result.suggestion);
      } else {
        setError(result.error);
      }
    });
  }

  function adopt() {
    if (!suggestion) return;
    setError(null);
    startTransition(async () => {
      const result = await adoptPlanAction(
        tripId,
        suggestion.days.map((day) => ({
          date: day.date,
          title: day.title,
          checkpoints: day.checkpoints,
        })),
      );
      if (result.ok) {
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium">AI で行程を提案</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {suggestion === null ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            suggest();
          }}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={departure}
              onChange={(event) => setDeparture(event.target.value)}
              placeholder="出発地(例: 東京駅)"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
            />
            <input
              type="text"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="到着予定地(例: 自宅)"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              開始日
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
              />
            </label>
            <label className="flex items-center gap-1">
              日数
              <input
                type="number"
                min={1}
                max={30}
                value={dayCount}
                onChange={(event) =>
                  setDayCount(Number(event.target.value) || 1)
                }
                className="w-16 rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
              />
            </label>
          </div>
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="要望(例: 城と温泉を入れたい。運転は 1 日 3 時間まで)"
            rows={2}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || !departure.trim() || !destination.trim()}
              className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
            >
              {pending ? "提案を作成中…(1 分ほどかかります)" : "提案してもらう"}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              閉じる
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <ol className="flex flex-col gap-2">
            {suggestion.days.map((day, index) => (
              <li
                key={day.date}
                className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
              >
                <p className="text-sm font-medium">
                  {index + 1}日目{" "}
                  <span className="font-normal text-zinc-500 dark:text-zinc-400">
                    {formatDay(day.date)}
                  </span>{" "}
                  {day.title}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {day.checkpoints.map((checkpoint, i) => (
                    <li key={i} className="flex items-baseline gap-1 text-sm">
                      <span aria-hidden title={CHECKPOINT_LABELS[checkpoint.type]}>
                        {CHECKPOINT_ICONS[checkpoint.type]}
                      </span>
                      <span>{checkpoint.name}</span>
                      {checkpoint.note && (
                        <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {checkpoint.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            採用後は通常の編集で調整できます。地点の位置は未定のため、検索で具体化してください
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={adopt}
              className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
            >
              {pending ? "追加中…" : "この内容でプランに追加"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setSuggestion(null)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              条件に戻る
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
