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
  defaultDeparture,
  onDone,
}: {
  tripId: string;
  transport: string | null;
  defaultStartDate: string;
  defaultDayCount: number;
  /** 1 日目の出発チェックポイント名(無ければ空文字) */
  defaultDeparture: string;
  onDone: () => void;
}) {
  const [departure, setDeparture] = useState(defaultDeparture);
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
          // 概算座標も含めて採用する(Google Maps のリンクで具体化したら上書きされる)
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
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">AI で行程を提案</p>
      {error && <p className="text-sm text-danger">{error}</p>}
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
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <input
              type="text"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="到着予定地(例: 自宅)"
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              開始日
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1"
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
                className="w-16 rounded-md border border-border bg-background px-2 py-1"
              />
            </label>
          </div>
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="要望(例: 城と温泉を入れたい。運転は 1 日 3 時間まで)"
            rows={2}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || !departure.trim() || !destination.trim()}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
            >
              {pending ? "提案を作成中…(1 分ほどかかります)" : "提案してもらう"}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-md border border-border px-3 py-1 text-sm"
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
                className="rounded-md border border-border p-2"
              >
                <p className="text-sm font-medium">
                  {index + 1}日目{" "}
                  <span className="font-normal text-muted">
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
                        <span className="truncate text-xs text-muted">
                          {checkpoint.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">
            採用後は通常の編集で調整できます。地点の位置は概算のため、Google Maps のリンクで具体化してください
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={adopt}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
            >
              {pending ? "追加中…" : "この内容でプランに追加"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setSuggestion(null)}
              className="rounded-md border border-border px-3 py-1 text-sm"
            >
              条件に戻る
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-md border border-border px-3 py-1 text-sm"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
