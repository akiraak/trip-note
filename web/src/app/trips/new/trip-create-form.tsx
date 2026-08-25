"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createTripAction } from "./actions";
import { TripOutlineStep } from "./trip-outline-step";
import { PlaceLink, type LinkedPlace } from "../[id]/place-link";
import { startTripOutlineAction } from "../outline-actions";
import type { TripOutlineInput } from "@/lib/ai";

// 旅行の作成フォーム(iOS の TripCreateView と同じ項目。移動手段は車固定)。
// 出発日時は日付と時刻を分けて送り、サーバ側で表示タイムゾーンの壁時計として解釈する
// (ブラウザのローカル TZ で解釈すると入力した日付と 1 日目の日付がずれ得るため)。
// 目的地が入力されていれば、作成後に AI の日数・宿泊地候補ステップへ進む

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

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
  // 作成済みの旅行(non-null になったら候補ステップ)。候補生成のジョブは
  // 作成ボタンの延長で 1 回だけ登録し、待つのは候補ステップに任せる
  const [created, setCreated] = useState<{
    tripId: string;
    input: TripOutlineInput;
    jobId: string | null;
    error: string | null;
  } | null>(null);

  // 現在の入力名と一致するときだけリンクで取れた座標を使う(名前を書き換えたら捨てる)
  const coordinate =
    departureCoordinate && departureCoordinate.name === departurePlace.trim()
      ? departureCoordinate
      : null;

  const submit = async () => {
    setPending(true);
    setError(null);
    const name = departurePlace.trim();
    const place = name
      ? {
          name,
          latitude: coordinate?.latitude ?? null,
          longitude: coordinate?.longitude ?? null,
        }
      : null;
    const result = await createTripAction({
      title,
      departure_date: date,
      departure_time: time,
      destination: destination.trim() || null,
      departure_place: place,
    });
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    // 目的地が無ければ候補を出しようがないので、そのまま旅行画面へ
    if (!destination.trim()) {
      router.push(`/trips/${result.id}`);
      return;
    }
    const input: TripOutlineInput = {
      destination: destination.trim(),
      departureDate: date,
      departureTime: time,
      departure: place?.name ?? null,
      departureLatitude: place?.latitude ?? null,
      departureLongitude: place?.longitude ?? null,
      // 移動手段は車固定(createTrip と同じ)
      transport: "car",
      request: null,
    };
    const started = await startTripOutlineAction(input);
    setCreated({
      tripId: result.id,
      input,
      jobId: started.ok ? started.jobId : null,
      error: started.ok ? null : started.error,
    });
  };

  if (created) {
    return (
      <TripOutlineStep
        tripId={created.tripId}
        input={created.input}
        initialJobId={created.jobId}
        initialError={created.error}
      />
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">タイトル</span>
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
        <span className="text-muted">出発日時</span>
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
          {timeZone} の時刻として保存します。この日付が 1 日目になります
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted">
          出発地(任意)
        </span>
        <input
          type="text"
          value={departurePlace}
          onChange={(event) => setDeparturePlace(event.target.value)}
          placeholder="例: 自宅"
          className={inputClass}
        />
        <div className="flex items-center gap-2 text-xs text-muted">
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
        <span className="text-xs text-muted">
          入力すると 1 日目の出発チェックポイントになります
        </span>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">
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

      <p className="text-xs text-muted">
        日数は決めなくて OK。作成後に「日を追加」や AI 行程提案で日程を組めます
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "作成中…" : "作成"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-md border border-border px-3 py-1 text-sm"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
