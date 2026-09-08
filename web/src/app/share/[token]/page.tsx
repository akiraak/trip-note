import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareCanvas } from "./share-canvas";
import { formatDateTime, formatPointTime } from "@/lib/format";
import { formatDistance, totalDistance } from "@/lib/geo";
import { findSharedTrip, readSharedTrip } from "@/lib/share";
import { tripStatus } from "@/lib/types";

// 共有ページ(docs/plans/share-page.md)。ログイン不要で、共有リンクのトークンが一致する
// 旅行の工程と写真を閲覧専用で見せる。表示する情報は Web 旅行詳細(trips/[id]/page.tsx)と同じ
// 集合で、編集・削除・AI 提案・終了の導線だけを持たない。
// 本番では /share/* だけが Cloudflare Access を Bypass する(GET / HEAD 以外は src/proxy.ts が 405 にする)

// DB はリクエスト時に読む(ビルド時に静的化しない)
export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/share/[token]">,
): Promise<Metadata> {
  const { token } = await props.params;
  const trip = findSharedTrip(token);
  return {
    title: trip ? `${trip.title} | 旅ログ` : "旅ログ",
    // 推測できない URL を検索エンジンに拾わせない
    robots: { index: false, follow: false },
  };
}

export default async function SharePage(props: PageProps<"/share/[token]">) {
  const { token } = await props.params;
  const shared = readSharedTrip(token);
  if (!shared) {
    notFound();
  }
  const { trip, points, media, plan, cachedLegs } = shared;
  const status = tripStatus(trip);
  const distance = totalDistance(points);
  // 写真・動画は共有用の配信(そのトークンの旅行に属するものだけ返す)から取る
  const mediaBasePath = `/share/${token}/media`;
  const mediaMarkers = media.flatMap((m) =>
    m.marker
      ? [
          {
            id: m.id,
            type: m.type,
            latitude: m.marker.latitude,
            longitude: m.marker.longitude,
          },
        ]
      : [],
  );

  // パネル上部: 旅行の情報(旅行詳細と同じ項目)
  const header = (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="truncate text-lg font-semibold">{trip.title}</h1>
        <span className="tabular shrink-0 text-[11px] tracking-[0.18em] text-muted uppercase">
          旅ログ
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Stat label="開始">
          {trip.started_at ? (
            formatDateTime(trip.started_at)
          ) : (
            <span className="text-accent">未出発</span>
          )}
        </Stat>
        <Stat label="終了">
          {trip.ended_at
            ? formatDateTime(trip.ended_at)
            : status === "in_progress"
              ? "進行中"
              : "—"}
        </Stat>
        <Stat label="出発予定">
          {trip.departure_at ? formatDateTime(trip.departure_at) : "—"}
        </Stat>
        <Stat label="目的地">{trip.destination ?? "—"}</Stat>
        <Stat label="地点数">{points.length}</Stat>
        <Stat label="総距離">{formatDistance(distance)}</Stat>
      </dl>
    </section>
  );

  // パネル下部: メディア(閲覧のみ)
  const footer = (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="tabular text-xs tracking-[0.18em] text-muted uppercase">
          Media
        </h2>
        {media.length === 0 ? (
          <p className="text-sm text-muted">写真・動画がありません</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {media.map((m) => (
              <li key={m.id}>
                {m.type === "photo" ? (
                  <a
                    href={`${mediaBasePath}/${m.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    {/* トークン付き動的配信のため next/image は使わない */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${mediaBasePath}/${m.id}`}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  </a>
                ) : (
                  <video
                    src={`${mediaBasePath}/${m.id}`}
                    controls
                    preload="metadata"
                    playsInline
                    className="aspect-square w-full rounded-md bg-black object-cover"
                  />
                )}
                <p className="tabular mt-0.5 text-[11px] text-muted">
                  {formatPointTime(m.taken_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
        このページは共有リンクを知っている人が見られます
      </p>
    </>
  );

  return (
    <ShareCanvas
      title={trip.title}
      status={status}
      points={points}
      media={mediaMarkers}
      checkpoints={plan.markers}
      planRoute={plan.route}
      cachedLegs={cachedLegs}
      days={plan.days}
      mediaBasePath={mediaBasePath}
      header={header}
      footer={footer}
    />
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="tabular text-[11px] tracking-[0.1em] text-muted uppercase">
        {label}
      </dt>
      <dd className="tabular mt-0.5">{children}</dd>
    </div>
  );
}
