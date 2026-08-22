"use client";

import { useMemo, useState } from "react";
import { searchPlacesAction } from "./actions";
import { SearchAssist } from "./search-assist";
import { CHECKPOINT_ICONS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { searchViewbox, type DayRoutePlace } from "@/lib/day-route";
import type { Place } from "@/lib/nominatim";

// Nominatim(サーバ経由プロキシ)の地点検索。結果の選択で onSelect を呼ぶ。
// チェックポイントの即時追加(plan-section)と、編集フォームでの位置設定の両方で使う。
// AI 検索補助(SearchAssist)の候補を選ぶと、そのクエリでこの検索を実行する。
// route(その日の経路)があれば、その周辺を優先して検索し AI 補助にも渡す
export function PlaceSearch({
  onSelect,
  selectLabel,
  route = [],
  disabled = false,
}: {
  onSelect: (place: Place) => void;
  selectLabel: string;
  route?: DayRoutePlace[];
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewbox = useMemo(() => searchViewbox(route), [route]);

  async function searchWith(rawQuery: string) {
    const q = rawQuery.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    const result = await searchPlacesAction(q, viewbox);
    setSearching(false);
    if (result.ok) {
      setPlaces(result.places);
    } else {
      setError(result.error);
    }
  }

  function search() {
    return searchWith(query);
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="場所名・住所で検索"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
        >
          {searching ? "検索中…" : "検索"}
        </button>
      </form>
      <SearchAssist
        route={route}
        disabled={disabled || searching}
        onQuery={(q) => {
          setQuery(q);
          searchWith(q);
        }}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {places && places.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          見つかりませんでした
        </p>
      )}
      {places && places.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {places.map((place, index) => (
            <li
              key={`${place.latitude},${place.longitude},${index}`}
              className="flex items-center gap-2 p-2"
            >
              <span aria-hidden>{CHECKPOINT_ICONS[place.guessedType]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {place.name}
                  <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {CHECKPOINT_LABELS[place.guessedType]}
                  </span>
                </span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {place.displayName}
                </span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(place)}
                className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {selectLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
