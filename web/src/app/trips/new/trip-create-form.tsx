"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createTripAction } from "./actions";
import { PlaceLink, type LinkedPlace } from "../[id]/place-link";

// 旅行の作成フォーム(iOS の TripCreateView と同じ項目。移動手段は車固定)。
// 出発日時は日付と時刻を分けて送り、サーバ側で表示タイムゾーンの壁時計として解釈する
// (ブラウザのローカル TZ で解釈すると入力した日付と 1 日目の日付がずれ得るため)

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700";

export function TripCreateForm({
  defaultDate,
  defaultTime,
  timeZone,
}: {
  defaultDate: string;
  defaultTime: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [destination, setDestination] = useState("");
  const [departurePlace, setDeparturePlace] = useState("");
  const [departureCoordinate, setDepartureCoordinate] =
    useState<LinkedPlace | null>(null);
  const [linking, setLinking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 現在の入力名と一致するときだけリンクで取れた座標を使う(名前を書き換えたら捨てる)
  const coordinate =
    departureCoordinate && departureCoordinate.name === departurePlace.trim()
      ? departureCoordinate
      : null;

  const submit = async () => {
    setPending(true);
    setError(null);
    const name = departurePlace.trim();
    const result = await createTripAction({
      title,
      departure_date: date,
      departure_time: time,
      destination: destination.trim() || null,
      departure_place: name
        ? {
            name,
            latitude: coordinate?.latitude ?? null,
            longitude: coordinate?.longitude ?? null,
          }
        : null,
    });
    if (result.ok) {
      router.push(`/trips/${result.id}`);
      return;
    }
    setError(result.error);
    setPending(false);
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">タイトル</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例: 松本旅行"
          required
          className={inputClass}
        />
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">出発日時</span>
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
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {timeZone} の時刻として保存します。この日付が 1 日目になります
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">
          出発地(任意)
        </span>
        <input
          type="text"
          value={departurePlace}
          onChange={(event) => setDeparturePlace(event.target.value)}
          placeholder="例: 自宅"
          className={inputClass}
        />
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {coordinate?.latitude != null && coordinate.longitude != null ? (
            <span>
              位置 {coordinate.latitude.toFixed(5)},{" "}
              {coordinate.longitude.toFixed(5)}
            </span>
          ) : (
            <span>位置は未設定(名前だけでも作成できます)</span>
          )}
          <button
            type="button"
            onClick={() => setLinking((v) => !v)}
            className="underline"
          >
            {linking ? "リンク入力を閉じる" : "Google Maps のリンクで設定"}
          </button>
        </div>
        {linking && (
          <PlaceLink
            selectLabel="この位置にする"
            onSelect={(place) => {
              setDeparturePlace(place.name);
              setDepartureCoordinate(place);
              setLinking(false);
            }}
          />
        )}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          入力すると 1 日目の出発チェックポイントになります
        </span>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">
          目的地(任意)
        </span>
        <input
          type="text"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="例: 上高地"
          className={inputClass}
        />
      </label>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        日数は決めなくて OK。作成後に「日を追加」や AI 行程提案で日程を組めます
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
        >
          {pending ? "作成中…" : "作成"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
