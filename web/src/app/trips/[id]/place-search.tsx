"use client";

import { useMemo, useState } from "react";
import {
  nearbyPlacesAction,
  resolveGoogleMapsLinkAction,
  searchPlacesAction,
} from "./actions";
import { SearchAssist } from "./search-assist";
import { searchCategory } from "@/lib/category-search";
import { CHECKPOINT_ICONS, CHECKPOINT_LABELS } from "@/lib/checkpoint-style";
import { searchViewbox, type DayRoutePlace } from "@/lib/day-route";
import { formatDistance } from "@/lib/format";
import { extractGoogleMapsUrl } from "@/lib/google-maps-share";
import type { Place } from "@/lib/nominatim";
import type { NearbyPlace } from "@/lib/overpass";

// Nominatim(サーバ経由プロキシ)の地点検索。結果の選択で onSelect を呼ぶ。
// チェックポイントの即時追加(plan-section)と、編集フォームでの位置設定の両方で使う。
// AI 検索補助(SearchAssist)の候補を選ぶと、そのクエリでこの検索を実行する。
// route(その日の経路)があれば、その周辺を優先して検索し AI 補助にも渡す。
// 入力が「観光地」などのカテゴリ語なら、地名検索の代わりに経路の近くをカテゴリで探す
// (Overpass。結果の「追加」は通常の検索結果と同じ onSelect に流す)。
// 入力に Google Maps の共有リンクが含まれていれば、サーバでリンクを展開してその場所を
// 1 件の結果として出す(座標が取れなければ名前で通常検索に切り替える)
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
  const [nearby, setNearby] = useState<NearbyPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** エラーではない補足(リンクから名前検索に切り替えた、など) */
  const [notice, setNotice] = useState<string | null>(null);
  const viewbox = useMemo(() => searchViewbox(route), [route]);

  /** Google Maps の共有リンク → サーバで展開して 1 件の結果にする */
  async function searchLink(link: string) {
    setNearby(null);
    setSearching(true);
    const result = await resolveGoogleMapsLinkAction(link);
    setSearching(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const { place } = result;
    if (place.latitude !== null && place.longitude !== null) {
      setPlaces([
        {
          name: place.name ?? "Google Maps の場所",
          displayName:
            place.precision === "pin"
              ? "Google Maps のリンク(ピンの位置)"
              : "Google Maps のリンク(地図の中心の位置。ピンとずれることがあります)",
          latitude: place.latitude,
          longitude: place.longitude,
          guessedType: "sightseeing",
        },
      ]);
      return;
    }
    // 座標が取れないリンク(名前だけ)は名前で通常検索に切り替える
    if (place.name) {
      setQuery(place.name);
      setNotice(`リンクから座標が取れなかったため「${place.name}」で検索しました`);
      await searchName(place.name);
    }
  }

  async function searchName(q: string) {
    setNearby(null);
    setSearching(true);
    const result = await searchPlacesAction(q, viewbox);
    setSearching(false);
    if (result.ok) {
      setPlaces(result.places);
    } else {
      setError(result.error);
    }
  }

  async function searchWith(rawQuery: string) {
    const q = rawQuery.trim();
    if (!q || searching) return;
    setError(null);
    setNotice(null);
    const link = extractGoogleMapsUrl(q);
    if (link) {
      await searchLink(link);
      return;
    }
    const category = searchCategory(q);
    if (category) {
      setPlaces(null);
      // viewbox が無い = 経路に座標が 1 つも無い
      if (!viewbox) {
        setNearby(null);
        setError("この日の経路に座標がないため、近くの観光地を探せません");
        return;
      }
      setSearching(true);
      const result = await nearbyPlacesAction(category, route);
      setSearching(false);
      if (result.ok) {
        setNearby(result.places);
      } else {
        setError(result.error);
      }
      return;
    }
    await searchName(q);
  }

  function selectNearby(place: NearbyPlace) {
    onSelect({
      name: place.name,
      displayName: `${place.kindLabel} · ${place.nearestRouteName} から ${formatDistance(place.distanceM)}`,
      latitude: place.latitude,
      longitude: place.longitude,
      guessedType: "sightseeing",
    });
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
          placeholder={
            viewbox
              ? "場所名・住所、または Google Maps のリンク(「観光地」で経路の近くを探す)"
              : "場所名・住所、または Google Maps のリンク"
          }
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
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Google Maps で場所を開き「共有」→「リンクをコピー」したものを貼ると、その場所を追加できます
      </p>
      <SearchAssist
        route={route}
        disabled={disabled || searching}
        onQuery={(q) => {
          setQuery(q);
          searchWith(q);
        }}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{notice}</p>
      )}
      {nearby && nearby.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          この日の経路の近くに観光地が見つかりませんでした
        </p>
      )}
      {nearby && nearby.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {nearby.map((place) => (
            <li key={place.id} className="flex items-center gap-2 p-2">
              <span aria-hidden>{CHECKPOINT_ICONS.sightseeing}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {place.name}
                  <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {place.kindLabel}
                  </span>
                </span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {place.nearestRouteName} から {formatDistance(place.distanceM)}
                  {place.wikipediaUrl && (
                    <>
                      {" · "}
                      <a
                        href={place.wikipediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        Wikipedia
                      </a>
                    </>
                  )}
                  {place.website && (
                    <>
                      {" · "}
                      <a
                        href={place.website}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        公式サイト
                      </a>
                    </>
                  )}
                </span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => selectNearby(place)}
                className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {selectLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
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
