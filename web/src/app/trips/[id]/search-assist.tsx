"use client";

import { useState, useTransition } from "react";
import { searchAssistAction } from "./actions";
import type { SearchAssistSuggestion } from "@/lib/ai";
import { CHECKPOINT_ICONS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import type { DayRoutePlace } from "@/lib/day-route";

// AI 検索補助。大まかな地域 + 要望から検索クエリ候補・地点候補をもらい、
// 選ぶと onQuery で親(PlaceSearch)の地図検索を実行する。
// 候補はあくまで検索の入口で、座標の確定は通常の地図検索に任せる。
// route(その日の経路)があれば文脈として渡し、地域は未入力でもよい

export function SearchAssist({
  onQuery,
  route = [],
  disabled = false,
}: {
  onQuery: (query: string) => void;
  route?: DayRoutePlace[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState("");
  const [request, setRequest] = useState("");
  const [suggestion, setSuggestion] = useState<SearchAssistSuggestion | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function assist() {
    setError(null);
    startTransition(async () => {
      const result = await searchAssistAction({
        area: area.trim() || null,
        type: null,
        request: request || null,
        route: route.length > 0 ? route : null,
      });
      if (result.ok) {
        setSuggestion(result.suggestion);
      } else {
        setError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="text-xs">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="underline"
        >
          AI に候補を聞く
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          assist();
        }}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder={
              route.length > 0
                ? "地域(空ならこの日の経路から推定)"
                : "地域(例: 松本市周辺)"
            }
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          />
          <button
            type="submit"
            disabled={pending || (!area.trim() && route.length === 0)}
            className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
          >
            {pending ? "候補を作成中…" : "AI に聞く"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
          >
            閉じる
          </button>
        </div>
        <input
          type="text"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="要望(例: 静かなカフェ。駐車場あり)"
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {suggestion && (
        <div className="flex flex-col gap-2">
          {suggestion.queries.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestion.queries.map((query) => (
                <button
                  key={query}
                  type="button"
                  disabled={disabled}
                  onClick={() => onQuery(query)}
                  className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  🔍 {query}
                </button>
              ))}
            </div>
          )}
          {suggestion.places.length > 0 && (
            <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {suggestion.places.map((place, index) => (
                <li key={index} className="flex items-center gap-2 p-2">
                  <span aria-hidden title={CHECKPOINT_LABELS[place.type]}>
                    {CHECKPOINT_ICONS[place.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{place.name}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {place.area}
                      {place.note && ` — ${place.note}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onQuery(place.name)}
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    検索
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
