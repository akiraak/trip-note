"use client";

import { useState } from "react";
import {
  OutlineCandidates,
  type OutlinePlace,
} from "../outline-candidates";
import {
  adoptTripOutlineAction,
  startTripOutlineAction,
} from "../outline-actions";
import { useOutlineJob } from "../use-outline-job";
import type { TripOutlineCandidate } from "@/lib/ai";

// 既存プランの続き(帰路など)を、旅行作成時と同じ AI 候補で足すフォーム
// (iOS の PlanExtensionView と同じ)。入力は 目的地 + 出発日時 の 2 つだけで、
// 出発地は今のプランの最終地点を自動で使う。
// 採用すると入力した出発日を起点に日が増える(既存の日と重なる日付は既存の日を使う)

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

export function PlanExtension({
  tripId,
  transport,
  departure,
  defaultDepartureDate,
  defaultDepartureTime,
  onDone,
}: {
  tripId: string;
  transport: string | null;
  /** 出発地(今のプランの最終地点。無ければ null = 未指定) */
  departure: OutlinePlace | null;
  /** 出発日の初期値 (YYYY-MM-DD。最終日の翌日) */
  defaultDepartureDate: string;
  /** 出発時刻の初期値 (HH:MM) */
  defaultDepartureTime: string;
  onDone: () => void;
}) {
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState(defaultDepartureDate);
  const [time, setTime] = useState(defaultDepartureTime);
  const [request, setRequest] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const { suggestion, error: jobError } = useOutlineJob(jobId);
  // ジョブの失敗とは別に、開始・採用の失敗もここに出す
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const error = actionError ?? jobError;
  const waiting = jobId !== null && !suggestion && !error;

  const start = async () => {
    setStarting(true);
    setActionError(null);
    const result = await startTripOutlineAction({
      destination: destination.trim(),
      departureDate: date,
      departureTime: time,
      departure: departure?.name ?? null,
      departureLatitude: departure?.latitude ?? null,
      departureLongitude: departure?.longitude ?? null,
      transport,
      request: request.trim() || null,
    });
    setStarting(false);
    if (result.ok) {
      setJobId(result.jobId);
      return;
    }
    setActionError(result.error);
  };

  const adopt = async (candidate: TripOutlineCandidate) => {
    setAdopting(true);
    setActionError(null);
    const result = await adoptTripOutlineAction(tripId, {
      dayCount: candidate.dayCount,
      nights: candidate.nights.map((night) => ({
        name: night.name,
        note: night.note,
        latitude: night.latitude,
        longitude: night.longitude,
      })),
      destinationLatitude: suggestion?.destinationLatitude ?? null,
      destinationLongitude: suggestion?.destinationLongitude ?? null,
      // 続きの区間なので、起点は入力した出発日、到着地は入力した目的地
      // (旅行そのものの目的地 trips.destination は書き換えない)
      startDate: date,
      destination: destination.trim(),
    });
    if (result.ok) {
      onDone();
      return;
    }
    setActionError(result.error);
    setAdopting(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">続きの行程を提案</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {suggestion ? (
        <div className="flex flex-col gap-2">
          <OutlineCandidates
            suggestion={suggestion}
            departure={departure}
            destinationName={destination.trim()}
            adopting={adopting}
            onAdopt={adopt}
          />
          <p className="text-xs text-muted">
            採用すると最終日の続きとして日が増えます。地図はおおよその位置で、採用後は通常の編集で調整でき、宿の位置は
            Google Maps のリンクで具体化できます
          </p>
          <div>
            <button
              type="button"
              onClick={onDone}
              className="rounded-md border border-border px-3 py-1 text-sm"
            >
              閉じる
            </button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <p className="text-sm text-muted">
            出発地 {departure?.name?.trim() || "未指定"}
            <span className="ml-1 text-xs">(今のプランの最終地点)</span>
          </p>
          <input
            type="text"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="目的地(例: シアトル)"
            className={inputClass}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              出発日
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-1">
              出発時刻
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1"
              />
            </label>
          </div>
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="要望(例: 海沿いを通りたい。運転は 1 日 3 時間まで)"
            rows={2}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={starting || waiting || !destination.trim()}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
            >
              {starting || waiting
                ? "候補を作成中…(1 分ほどかかります)"
                : "候補を出す"}
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
      )}
    </div>
  );
}
