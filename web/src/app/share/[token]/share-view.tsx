"use client";

import { useMemo, useState } from "react";
import { PhotoLightbox } from "./photo-lightbox";
import { ShareDayMap } from "./share-day-map";
import { TripMap } from "@/app/trips/[id]/trip-map";
import { formatDayWithWeekday, formatPointTime } from "@/lib/format";
import { shareSummaryLine } from "@/lib/share-summary";
import type { SharedDay, SharedMedia, SharedTrackPoint, SharedTrip } from "@/lib/share";

// 共有ページの本体(docs/plans/share-page-redesign.md)。
// 画面の一番上に旅行全体の地図を全幅で置き(写真マーカーは載せない)、その下に
// 日ごとのカード(その日の地図・立ち寄り先・写真)を並べる。閲覧専用で編集の導線は持たない。
//
// 道路形状のレグは SSR で渡されたキャッシュ済みの分だけを使う(resolveLegs={false})。
// 公開経路から Server Action を呼ばせないため

export function ShareView({
  shared,
  mediaBasePath,
}: {
  shared: SharedTrip;
  /** 写真・動画の配信元の先頭(/share/<token>/media) */
  mediaBasePath: string;
}) {
  const { points, markers, route, days, otherMedia, cachedLegs } = shared;
  // 拡大表示は旅行全体を撮影順に送れるようにする。日ごとのグリッドは
  // この平らな並びのどこから始まるかだけを持つ
  const { flat, offsets } = useMemo(() => {
    const flat: SharedMedia[] = [];
    const offsets: number[] = [];
    for (const day of days) {
      offsets.push(flat.length);
      flat.push(...day.media);
    }
    offsets.push(flat.length);
    flat.push(...otherMedia);
    return { flat, offsets };
  }, [days, otherMedia]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const hasMap = points.length > 0 || markers.length > 0;

  return (
    <div className="flex flex-1 flex-col">
      {hasMap ? (
        <div className="relative h-[300px] shrink-0 lg:h-[420px]">
          <TripMap
            points={points}
            media={[]}
            checkpoints={markers}
            planRoute={route}
            cachedLegs={cachedLegs}
            resolveLegs={false}
            className="h-full w-full"
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[46%] bg-gradient-to-b from-background via-background/70 to-transparent" />
          <div className="pointer-events-none absolute inset-x-4 top-5 lg:inset-x-10 lg:top-6">
            <TripHeading shared={shared} />
          </div>
        </div>
      ) : (
        <div className="px-4 pt-6 lg:px-10 lg:pt-8">
          <TripHeading shared={shared} />
        </div>
      )}

      <div className="flex flex-col gap-3.5 px-4 pt-4 lg:gap-4 lg:px-10 lg:pt-7">
        {days.map((day, index) => (
          <DayCard
            key={day.id}
            day={day}
            dayNumber={index + 1}
            points={points}
            cachedLegs={cachedLegs}
            mediaBasePath={mediaBasePath}
            firstIndex={offsets[index]}
            onOpen={setOpenIndex}
          />
        ))}
        {otherMedia.length > 0 && (
          <section className="rounded-xl border border-border bg-surface p-3.5 lg:p-6">
            <header className="flex items-baseline gap-2.5 pb-2.5 lg:pb-3">
              <h2 className="text-sm font-medium lg:text-[15px]">その他の写真</h2>
              <span className="tabular ml-auto text-xs text-muted lg:text-[13px]">
                {mediaCountLabel(otherMedia)}
              </span>
            </header>
            <PhotoGrid
              media={otherMedia}
              mediaBasePath={mediaBasePath}
              firstIndex={offsets[days.length]}
              onOpen={setOpenIndex}
            />
          </section>
        )}
      </div>

      <footer className="flex items-center justify-center gap-2 px-4 pt-6 pb-8 text-[11px] text-muted lg:pt-8 lg:pb-10">
        <span className="tabular tracking-[0.18em] uppercase">旅ログ</span>
        <span aria-hidden>·</span>
        <span>このページは共有リンクを知っている人が見られます</span>
      </footer>

      {openIndex !== null && (
        <PhotoLightbox
          items={flat}
          index={openIndex}
          mediaBasePath={mediaBasePath}
          onClose={() => setOpenIndex(null)}
          onMove={setOpenIndex}
        />
      )}
    </div>
  );
}

/** 旅行名と、期間・日数・写真の件数の 1 行 */
function TripHeading({ shared }: { shared: SharedTrip }) {
  const { trip, days, photoCount, videoCount } = shared;
  // 文面は OGP の説明文と同じものを使う(lib/share-summary.ts)
  const summary = shareSummaryLine({
    firstDate: days[0]?.date ?? null,
    lastDate: days[days.length - 1]?.date ?? null,
    dayCount: days.length,
    photoCount,
    videoCount,
  });
  // 地図の右上には MapLibre のズームボタンが出るので、ここには何も置かない
  // (旅ログの表記はフッタに置いてある)
  return (
    <div className="flex min-w-0 flex-col gap-1.5 pr-14">
      <h1 className="truncate text-xl font-semibold lg:text-[26px]">
        {trip.title}
      </h1>
      {summary && (
        <p className="tabular text-xs text-muted lg:text-[13px]">{summary}</p>
      )}
    </div>
  );
}

function DayCard({
  day,
  dayNumber,
  points,
  cachedLegs,
  mediaBasePath,
  firstIndex,
  onOpen,
}: {
  day: SharedDay;
  dayNumber: number;
  /** 旅行全体の記録点。その日のぶんは trackStart/trackEnd で切り出す */
  points: SharedTrackPoint[];
  cachedLegs: SharedTrip["cachedLegs"];
  mediaBasePath: string;
  /** 拡大表示の並びの中で、この日の 1 枚目が何番目か */
  firstIndex: number;
  onOpen: (index: number) => void;
}) {
  const track = useMemo(
    () => points.slice(day.trackStart, day.trackEnd),
    [points, day.trackStart, day.trackEnd],
  );
  const hasMap = day.markers.length > 0 || track.length > 0;

  return (
    <section className="rounded-xl border border-border bg-surface p-3.5 lg:p-6">
      <header className="flex items-baseline gap-2.5 pb-2.5 lg:pb-3">
        <h2 className="text-sm font-medium lg:text-[15px]">{dayNumber}日目</h2>
        <span className="tabular text-xs text-muted lg:text-[13px]">
          {formatDayWithWeekday(day.date)}
        </span>
        {day.media.length > 0 && (
          <span className="tabular ml-auto text-xs text-muted lg:text-[13px]">
            {mediaCountLabel(day.media)}
          </span>
        )}
      </header>
      <div className="lg:flex lg:gap-5">
        {hasMap && (
          <ShareDayMap
            markers={day.markers}
            anchor={day.anchor}
            track={track}
            cachedLegs={cachedLegs}
            className="mb-2.5 h-[150px] overflow-hidden rounded-lg lg:mb-0 lg:h-auto lg:min-h-[200px] lg:w-[480px] lg:shrink-0"
          />
        )}
        <div className="min-w-0 lg:flex-1">
          {day.places.length > 0 ? (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted lg:text-[14px]">
              {day.places.join(" → ")}
            </p>
          ) : (
            <p className="text-sm text-muted">立ち寄り先なし</p>
          )}
          {day.media.length > 0 && (
            <div className="mt-2.5 lg:mt-3">
              <PhotoGrid
                media={day.media}
                mediaBasePath={mediaBasePath}
                firstIndex={firstIndex}
                onOpen={onOpen}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PhotoGrid({
  media,
  mediaBasePath,
  firstIndex,
  onOpen,
}: {
  media: SharedMedia[];
  mediaBasePath: string;
  firstIndex: number;
  onOpen: (index: number) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2 lg:grid-cols-6">
      {media.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onOpen(firstIndex + index)}
            aria-label={`${formatPointTime(item.taken_at)} の${item.type === "photo" ? "写真" : "動画"}を開く`}
            className="relative block w-full cursor-zoom-in overflow-hidden rounded-lg focus:outline-2 focus:outline-offset-2 focus:outline-accent"
          >
            {item.type === "photo" ? (
              // トークン付き動的配信のため next/image は使わない
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${mediaBasePath}/${item.id}`}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            ) : (
              <>
                <video
                  src={`${mediaBasePath}/${item.id}`}
                  muted
                  playsInline
                  preload="metadata"
                  className="pointer-events-none aspect-square w-full bg-black object-cover"
                />
                <span className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="grid size-8 place-items-center rounded-full bg-background/70">
                    <PlayIcon />
                  </span>
                </span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

/** 動画が混ざっていれば「件」、写真だけなら「枚」 */
function mediaCountLabel(media: SharedMedia[]): string {
  const hasVideo = media.some((item) => item.type === "video");
  return hasVideo ? `${media.length} 件` : `${media.length} 枚`;
}
