"use client";

import { useState, useTransition } from "react";
import {
  addCheckpointAction,
  addDayAction,
  deleteCheckpointAction,
  deleteDayAction,
  moveCheckpointAction,
  updateCheckpointAction,
  updateDayAction,
  type ActionResult,
} from "./actions";
import { AiPlanSuggest } from "./ai-plan";
import { CheckpointForm } from "./checkpoint-form";
import { PlaceSearch } from "./place-search";
import { CHECKPOINT_ICONS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { formatDay } from "@/lib/format";
import type { CheckpointType } from "@/lib/types";

// 旅行詳細のプラン(日別)表示・編集。データは server component (page.tsx) から
// 受け取り、変更は Server Actions 経由。アクションが revalidatePath するので
// 完了後は新しい props が流れてくる(クライアント側でリストの複製は持たない)

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
  checkpoints: PlanCheckpoint[];
};

export function PlanSection({
  tripId,
  days,
  transport,
  aiDefaults,
}: {
  tripId: string;
  days: PlanDay[];
  transport: string | null;
  /** AI 提案フォームの初期値(page.tsx で計算) */
  aiDefaults: { startDate: string; dayCount: number };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

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
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {days.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          プランはまだありません
        </p>
      )}
      {days.map((day, index) => (
        <DayCard
          key={day.id}
          day={day}
          dayNumber={index + 1}
          pending={pending}
          run={run}
        />
      ))}
      {aiOpen && (
        <AiPlanSuggest
          tripId={tripId}
          transport={transport}
          defaultStartDate={aiDefaults.startDate}
          defaultDayCount={aiDefaults.dayCount}
          onDone={() => setAiOpen(false)}
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => addDayAction(tripId))}
          className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          + 日を追加
        </button>
        {!aiOpen && (
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
  pending,
  run,
}: {
  day: PlanDay;
  dayNumber: number;
  pending: boolean;
  run: RunAction;
}) {
  // 同時に開くフォームは日ごとに 1 つ
  const [mode, setMode] = useState<
    null | "edit-day" | "add-search" | "add-manual"
  >(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(
    null,
  );

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="font-medium">
          {dayNumber}日目{" "}
          <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
            {formatDay(day.date)}
          </span>
        </span>
        {day.title && <span className="truncate text-sm">{day.title}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode(mode === "edit-day" ? null : "edit-day")}
            className="underline"
          >
            編集
          </button>
          {confirmingDelete ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => deleteDayAction(day.id), () =>
                    setConfirmingDelete(false),
                  )
                }
                className="font-medium text-red-600 underline disabled:opacity-50"
              >
                本当に削除する
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="underline"
              >
                やめる
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-red-600 underline"
            >
              削除
            </button>
          )}
        </span>
      </header>
      <div className="flex flex-col gap-2 p-3">
        {day.note && !confirmingDelete && mode !== "edit-day" && (
          <p className="text-sm whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
            {day.note}
          </p>
        )}
        {confirmingDelete && (
          <p className="text-sm text-red-600">
            この日とチェックポイント {day.checkpoints.length} 件を削除します
          </p>
        )}
        {mode === "edit-day" && (
          <DayForm
            day={day}
            pending={pending}
            onSubmit={(fields) =>
              run(() => updateDayAction(day.id, fields), () => setMode(null))
            }
            onCancel={() => setMode(null)}
          />
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
        {mode === "add-search" && (
          <PlaceSearch
            selectLabel="追加"
            disabled={pending}
            onSelect={(place) =>
              run(() =>
                addCheckpointAction(day.id, {
                  type: place.guessedType,
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
              run(() => addCheckpointAction(day.id, input), () => setMode(null))
            }
            onCancel={() => setMode(null)}
          />
        )}
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode(mode === "add-search" ? null : "add-search")}
            className="underline"
          >
            {mode === "add-search" ? "検索を閉じる" : "+ 検索して追加"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "add-manual" ? null : "add-manual")}
            className="underline"
          >
            {mode === "add-manual" ? "手入力を閉じる" : "+ 手入力で追加"}
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
  onSubmit: (fields: { title: string | null; note: string | null }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(day.title ?? "");
  const [note, setNote] = useState(day.note ?? "");
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ title: title || null, note: note || null });
      }}
    >
      <input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="タイトル(例: 松本周辺を観光して泊)"
        className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="メモ"
        rows={2}
        className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
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
    <li className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
      <span aria-hidden title={CHECKPOINT_LABELS[checkpoint.type]}>
        {CHECKPOINT_ICONS[checkpoint.type]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate">{checkpoint.name}</span>
          {checkpoint.planned_time && (
            // 予定時刻はブラウザのローカル TZ で表示する(SSR とはずれ得るので警告を抑止)
            <span
              suppressHydrationWarning
              className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400"
            >
              {new Date(checkpoint.planned_time).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {checkpoint.latitude === null && (
            <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
              位置未定
            </span>
          )}
        </span>
        {checkpoint.note && (
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
            {checkpoint.note}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs">
        <button
          type="button"
          disabled={pending || isFirst}
          onClick={() => run(() => moveCheckpointAction(checkpoint.id, -1))}
          className="rounded border border-zinc-300 px-1.5 py-0.5 disabled:opacity-30 dark:border-zinc-700"
          aria-label="上へ"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={pending || isLast}
          onClick={() => run(() => moveCheckpointAction(checkpoint.id, 1))}
          className="rounded border border-zinc-300 px-1.5 py-0.5 disabled:opacity-30 dark:border-zinc-700"
          aria-label="下へ"
        >
          ↓
        </button>
        <button type="button" onClick={onEdit} className="ml-1 underline">
          編集
        </button>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteCheckpointAction(checkpoint.id))}
              className="font-medium text-red-600 underline disabled:opacity-50"
            >
              本当に削除する
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="underline"
            >
              やめる
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-red-600 underline"
          >
            削除
          </button>
        )}
      </span>
    </li>
  );
}
