"use client";

import { useState } from "react";
import { resolveGoogleMapsLinkAction } from "./actions";
import {
  extractGoogleMapsUrl,
  type ResolvedGoogleMapsPlace,
} from "@/lib/google-maps-share";

// Google Maps のリンク(共有テキストごと貼ってもよい)から場所を 1 件取り出す入力欄。
// 解決はサーバ(resolveGoogleMapsLinkAction → lib/google-maps-share.ts)で行う。
// チェックポイントの追加(plan-section)と、編集フォームでの位置設定の両方で使う。
// 座標が取れないリンク(名前だけ)もあるので、座標なしを許可するか
// (allowsMissingCoordinate)は呼び出し側が決める

export type LinkedPlace = {
  name: string;
  latitude: number | null;
  longitude: number | null;
};

/** リンクから得た位置の精度の説明(結果行の 2 行目) */
function linkPrecisionLabel(place: ResolvedGoogleMapsPlace): string {
  switch (place.precision) {
    case "pin":
      return "Google Maps のリンク(ピンの位置)";
    case "center":
      return "Google Maps のリンク(地図の中心の位置。ピンとずれることがあります)";
    case "geocoded":
      return `Google Maps のリンク(住所から推定した位置: ${place.geocodedQuery ?? ""}。ピンとずれることがあります)`;
    case "area":
      return `Google Maps のリンク(住所「${place.geocodedQuery ?? ""}」のおおよその位置。編集で位置を直せます)`;
    default:
      return "座標が取れませんでした";
  }
}

export function PlaceLink({
  onSelect,
  selectLabel,
  /** 座標が取れなかった結果も選べるか(日詳細の「追加」だけ true) */
  allowsMissingCoordinate = false,
  disabled = false,
}: {
  onSelect: (place: LinkedPlace) => void;
  selectLabel: string;
  allowsMissingCoordinate?: boolean;
  disabled?: boolean;
}) {
  const [link, setLink] = useState("");
  const [place, setPlace] = useState<ResolvedGoogleMapsPlace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    const input = link.trim();
    if (!input || loading) return;
    setError(null);
    if (!extractGoogleMapsUrl(input)) {
      setPlace(null);
      setError("Google Maps のリンクを貼ってください");
      return;
    }
    setPlace(null);
    setLoading(true);
    const result = await resolveGoogleMapsLinkAction(input);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPlace(result.place);
  }

  const hasCoordinate =
    place !== null && place.latitude !== null && place.longitude !== null;
  const selectable = place !== null && (hasCoordinate || allowsMissingCoordinate);

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          resolve();
        }}
      >
        <input
          type="text"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="Google Maps のリンクを貼る"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={loading || !link.trim()}
          className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
        >
          {loading ? "読み込み中…" : "読み込む"}
        </button>
      </form>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Google Maps で場所を開き「共有」→「リンクをコピー」したものを貼ると、その場所を追加できます
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {place && (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          <li className="flex items-center gap-2 p-2">
            <span aria-hidden>📍</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {place.name ?? "Google Maps の場所"}
              </span>
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {linkPrecisionLabel(place)}
                {!hasCoordinate &&
                  (allowsMissingCoordinate
                    ? "(座標未設定のまま追加できます)"
                    : "(位置を設定できません)")}
              </span>
            </span>
            {selectable && (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onSelect({
                    name: place.name ?? "Google Maps の場所",
                    latitude: place.latitude,
                    longitude: place.longitude,
                  })
                }
                className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {selectLabel}
              </button>
            )}
          </li>
        </ul>
      )}
    </div>
  );
}
