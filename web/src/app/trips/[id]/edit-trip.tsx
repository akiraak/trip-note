"use client";

import { useState } from "react";
import { updateTripAction } from "./actions";
import { departureShiftDays, planShiftNotice } from "@/lib/plan-dates";

// 旅行のタイトル・出発予定・目的地の編集(iOS の TripEditView と同じ項目。移動手段は車固定)。
// 出発日時は日付と時刻を分けて送り、サーバ側で表示タイムゾーンの壁時計として解釈する
// (trips/new/trip-create-form.tsx と同じ扱い。ローカル TZ で解釈すると日付がずれ得るため)

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

export function EditTrip({
  tripId,
  initial,
  timeZone,
  firstDayDate,
}: {
  tripId: string;
  /** 出発予定は表示 TZ の壁時計に割った日付・時刻(未設定なら null) */
  initial: {
    title: string;
    departureDate: string | null;
    departureTime: string | null;
    destination: string;
  };
  timeZone: string;
  /** プラン 1 日目の日付(YYYY-MM-DD)。出発日を変えたときに動く量の予告に使う */
  firstDayDate: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm underline"
        >
          旅行を編集
        </button>
      </div>
    );
  }
  return (
    <EditTripForm
      tripId={tripId}
      initial={initial}
      timeZone={timeZone}
      firstDayDate={firstDayDate}
      onClose={() => setOpen(false)}
    />
  );
}

function EditTripForm({
  tripId,
  initial,
  timeZone,
  firstDayDate,
  onClose,
}: {
  tripId: string;
  initial: {
    title: string;
    departureDate: string | null;
    departureTime: string | null;
    destination: string;
  };
  timeZone: string;
  firstDayDate: string | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [hasDeparture, setHasDeparture] = useState(
    initial.departureDate !== null,
  );
  // チェックを外して付け直したときのために、既定値は今日ではなく元の値(無ければ空)
  const [date, setDate] = useState(initial.departureDate ?? "");
  const [time, setTime] = useState(initial.departureTime ?? "08:00");
  const [destination, setDestination] = useState(initial.destination);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shiftNotice = planShiftNotice(
    departureShiftDays(
      initial.departureDate,
      hasDeparture ? date : null,
      firstDayDate,
    ),
  );

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await updateTripAction(tripId, {
      title,
      departure_date: hasDeparture ? date : null,
      departure_time: hasDeparture ? time : null,
      destination: destination.trim() || null,
    });
    if (result.ok) {
      onClose();
      return;
    }
    setError(result.error);
    setPending(false);
  };

  return (
    <form
      className="mb-4 flex flex-col gap-3 rounded-lg border border-border p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-muted">タイトル</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          className={inputClass}
        />
      </label>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hasDeparture}
            onChange={(event) => setHasDeparture(event.target.checked)}
          />
          <span className="text-muted">
            出発日時を設定
          </span>
        </label>
        {hasDeparture && (
          <>
            <div className="flex gap-2">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                className={inputClass}
              />
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                required
                className={inputClass}
              />
            </div>
            <span className="text-xs text-muted">
              {timeZone} の時刻として保存します
            </span>
            {/* 保存でプランの日付も動くので、動く量を先に見せる(iOS の TripEditView と同じ) */}
            {shiftNotice && (
              <span className="text-xs text-accent">{shiftNotice}</span>
            )}
          </>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-muted">目的地(任意)</span>
        <input
          type="text"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="例: 上高地"
          className={inputClass}
        />
      </label>

      {error && <p className="text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded-md bg-accent px-3 py-1 font-medium text-background disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
