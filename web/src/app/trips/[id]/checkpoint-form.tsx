"use client";

import { useState } from "react";
import { PlaceLink } from "./place-link";
import { CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import type { CheckpointInput } from "@/lib/plan";
import { CHECKPOINT_TYPES, type CheckpointType } from "@/lib/types";

// チェックポイントの追加(手入力)・編集の共通フォーム。
// 予定時刻の入力・表示はブラウザのローカルタイムゾーン(iOS と同じく端末基準)

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function CheckpointForm({
  initial,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CheckpointInput | null;
  pending: boolean;
  submitLabel: string;
  onSubmit: (input: CheckpointInput) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<CheckpointType>(initial?.type ?? "sightseeing");
  const [name, setName] = useState(initial?.name ?? "");
  const [plannedTime, setPlannedTime] = useState(
    toLocalInputValue(initial?.planned_time ?? null),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [latitude, setLatitude] = useState<number | null>(
    initial?.latitude ?? null,
  );
  const [longitude, setLongitude] = useState<number | null>(
    initial?.longitude ?? null,
  );
  const [locating, setLocating] = useState(false);

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          type,
          name,
          latitude,
          longitude,
          planned_time: fromLocalInputValue(plannedTime),
          note: note || null,
        });
      }}
    >
      <div className="flex gap-2">
        <select
          value={type}
          onChange={(event) => setType(event.target.value as CheckpointType)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          {CHECKPOINT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CHECKPOINT_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="名前"
          required
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        予定時刻
        <input
          type="datetime-local"
          value={plannedTime}
          onChange={(event) => setPlannedTime(event.target.value)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
        {plannedTime && (
          <button
            type="button"
            onClick={() => setPlannedTime("")}
            className="text-xs underline"
          >
            クリア
          </button>
        )}
      </label>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="メモ"
        rows={2}
        className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
      />
      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          位置
          {latitude !== null && longitude !== null ? (
            <>
              <span>
                {latitude.toFixed(5)}, {longitude.toFixed(5)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setLatitude(null);
                  setLongitude(null);
                }}
                className="text-xs underline"
              >
                クリア
              </button>
            </>
          ) : (
            <span>未設定(地域だけ決めておく場合はこのままで可)</span>
          )}
          <button
            type="button"
            onClick={() => setLocating((v) => !v)}
            className="text-xs underline"
          >
            {locating ? "リンク入力を閉じる" : "Google Maps のリンクで設定"}
          </button>
        </div>
        {locating && (
          <PlaceLink
            selectLabel="この位置にする"
            onSelect={(place) => {
              setLatitude(place.latitude);
              setLongitude(place.longitude);
              if (!name.trim()) {
                setName(place.name);
              }
              setLocating(false);
            }}
          />
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
        >
          {submitLabel}
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
