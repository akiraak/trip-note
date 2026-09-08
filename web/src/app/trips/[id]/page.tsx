import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteMedia } from "./delete-media";
import { DeleteTrip } from "./delete-trip";
import { EditTrip } from "./edit-trip";
import { EndTrip } from "./end-trip";
import { type PlanExtensionDefaults } from "./plan-section";
import { ShareLink } from "./share-link";
import { TripCanvas } from "./trip-canvas";
import { getDb } from "@/lib/db";
import { formatDateTime, formatPointTime, TIME_ZONE } from "@/lib/format";
import { dateStringOf, nextDate, timeStringOf } from "@/lib/plan";
import { formatDistance, totalDistance } from "@/lib/geo";
import { buildLegs, legKey } from "@/lib/route-legs";
import { readCachedLegs } from "@/lib/routing";
import { requestOrigin } from "@/lib/request-origin";
import { readTripPlan } from "@/lib/trip-plan";
import {
  tripStatus,
  type LocationPoint,
  type Media,
  type Trip,
} from "@/lib/types";

export default async function TripDetailPage(props: PageProps<"/trips/[id]">) {
  const { id } = await props.params;
  const db = getDb();
  const trip = db
    .prepare("select * from trips where id = ? and deleted_at is null")
    .get(id) as Trip | undefined;
  if (!trip) {
    notFound();
  }
  const status = tripStatus(trip);
  const points = db
    .prepare(
      "select * from location_points where trip_id = ? order by recorded_at",
    )
    .all(id) as LocationPoint[];
  const distance = totalDistance(points);
  // 一覧は撮影・追加時刻の新しい順(iOS の TripEntity.sortedMedia と揃える)。
  // 地図マーカー用の座標は、メディア自身の撮影位置(EXIF GPS)を優先し、
  // 無ければ紐付いた記録点を使う(どちらも無いメディアはグリッドのみ)
  const media = db
    .prepare(
      `select m.*,
              coalesce(m.latitude, p.latitude) as marker_latitude,
              coalesce(m.longitude, p.longitude) as marker_longitude
       from media m
       left join location_points p on p.id = m.location_point_id
       where m.trip_id = ? and m.deleted_at is null
       order by m.taken_at desc, m.id desc`,
    )
    .all(id) as (Media & {
    marker_latitude: number | null;
    marker_longitude: number | null;
  })[];
  const mediaMarkers = media
    .filter((m) => m.marker_latitude !== null && m.marker_longitude !== null)
    .map((m) => ({
      id: m.id,
      type: m.type,
      latitude: m.marker_latitude as number,
      longitude: m.marker_longitude as number,
    }));

  // プラン(日別チェックポイント)。日カード・地図のピン・破線ルートは同じ集合から作る
  // (tombstone は日・チェックポイントとも除外済み。lib/trip-plan.ts を参照)
  const {
    days: planDays,
    markers: checkpointMarkers,
    route: planRoute,
  } = readTripPlan(id);
  // 「続きの行程を提案」フォームの初期値(iOS の PlanExtensionView と同じ):
  // 出発地 = 今のプランの最終地点(最後の日の最後のチェックポイント。無ければ
  // 1 日目の出発チェックポイント)、出発日時 = 最終日の翌日 9:00
  // (日が無ければ出発予定 ?? 開始 ?? 今日)。目的地は入力してもらうので初期値を入れない
  const lastDay = planDays[planDays.length - 1];
  const lastPlace =
    lastDay?.checkpoints[lastDay.checkpoints.length - 1] ??
    planDays[0]?.checkpoints.find((c) => c.type === "departure");
  const planStart = trip.departure_at ?? trip.started_at;
  const planStartDate = planStart ? new Date(planStart) : null;
  const extensionDefaults: PlanExtensionDefaults = {
    departure: lastPlace
      ? {
          name: lastPlace.name,
          latitude: lastPlace.latitude,
          longitude: lastPlace.longitude,
        }
      : null,
    departureDate: lastDay
      ? nextDate(lastDay.date)
      : dateStringOf(planStartDate ?? new Date()),
    departureTime:
      !lastDay && planStartDate ? timeStringOf(planStartDate) : "09:00",
  };
  // 編集フォームの初期値。出発予定は表示 TZ の壁時計に割って渡す(保存時も同じ扱い)
  const departureDate = trip.departure_at ? new Date(trip.departure_at) : null;
  const editInitial = {
    title: trip.title,
    departureDate: departureDate ? dateStringOf(departureDate) : null,
    departureTime: departureDate ? timeStringOf(departureDate) : null,
    destination: trip.destination ?? "",
  };
  // 共有リンクの絶対 URL。ブラウザ側で組むとハイドレーション前に出せないので、
  // リクエストの Host から組んでそのまま渡す(本番は Cloudflare Tunnel が元の Host を通す)
  const shareUrl = trip.share_token
    ? `${await requestOrigin()}/share/${trip.share_token}`
    : null;
  // 日ごとのレグ(前泊地起点 + その日の訪問順)は、この全体レグ列の部分集合になる。
  // キャッシュ済みの分を初期値として渡し、初回描画から道路形状で描く(OSRM は呼ばない)
  const cachedLegs = readCachedLegs(
    buildLegs({ points: planRoute }).map((leg) => legKey(leg.from, leg.to)),
  );

  // パネル上部: 旅行の情報(iOS の旅行画面と同じ項目)と編集導線
  const header = (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="truncate text-lg font-semibold">{trip.title}</h1>
        <Link
          href="/"
          className="tabular shrink-0 text-[11px] tracking-[0.18em] text-muted uppercase hover:text-foreground"
        >
          旅ログ
        </Link>
      </div>
      <EditTrip
        tripId={trip.id}
        initial={editInitial}
        timeZone={TIME_ZONE}
        firstDayDate={planDays[0]?.date ?? null}
      />
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
      {/* ログイン不要の共有リンク(docs/plans/share-page.md)。発行・停止は Web だけ */}
      <ShareLink tripId={trip.id} url={shareUrl} />
      {/* 終了は進行中のときだけ(iOS の TripDetailView と同じ条件・同じ位置) */}
      {status === "in_progress" && <EndTrip tripId={trip.id} />}
    </section>
  );

  // パネル下部: メディア・タイムライン・削除
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
                    href={`/media/${m.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    {/* 認証付き動的配信のため next/image は使わない */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/media/${m.id}`}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  </a>
                ) : (
                  <video
                    src={`/media/${m.id}`}
                    controls
                    preload="metadata"
                    playsInline
                    className="aspect-square w-full rounded-md bg-black object-cover"
                  />
                )}
                <div className="mt-0.5 flex items-start justify-between gap-2">
                  <p className="tabular text-[11px] text-muted">
                    {formatPointTime(m.taken_at)}
                  </p>
                  <DeleteMedia tripId={trip.id} mediaId={m.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <DeleteTrip tripId={trip.id} />
    </>
  );

  return (
    <TripCanvas
      title={trip.title}
      status={status}
      points={points.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        recorded_at: p.recorded_at,
      }))}
      media={mediaMarkers}
      checkpoints={checkpointMarkers}
      planRoute={planRoute}
      cachedLegs={cachedLegs}
      tripId={trip.id}
      days={planDays}
      // 移動手段は車に固定(古い旅行の null も car として AI に渡す)
      transport={trip.transport ?? "car"}
      extensionDefaults={extensionDefaults}
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
