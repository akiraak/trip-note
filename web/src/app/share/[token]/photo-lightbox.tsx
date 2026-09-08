"use client";

import { useCallback, useEffect } from "react";
import { formatPointTime } from "@/lib/format";
import type { SharedMedia } from "@/lib/share";

// 共有ページの写真・動画の拡大表示。旅行全体を撮影順に前後へ送れる。
// 表示だけで、保存や共有の導線は持たない(公開経路なので Server Action も呼ばない)

export function PhotoLightbox({
  items,
  index,
  mediaBasePath,
  onClose,
  onMove,
}: {
  /** ページに出ている写真・動画を並び順のまま平らにしたもの */
  items: SharedMedia[];
  index: number;
  /** 配信元の先頭(/share/<token>/media) */
  mediaBasePath: string;
  onClose: () => void;
  /** 前後へ移動する(端では呼ばれない) */
  onMove: (nextIndex: number) => void;
}) {
  const item = items[index];
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;

  const move = useCallback(
    (offset: number) => {
      const next = index + offset;
      if (next >= 0 && next < items.length) {
        onMove(next);
      }
    },
    [index, items.length, onMove],
  );

  // Esc で閉じ、左右キーで送る。開いている間はページの背後をスクロールさせない
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft") {
        move(-1);
      } else if (event.key === "ArrowRight") {
        move(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [move, onClose]);

  if (!item) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="写真・動画の拡大表示"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4"
    >
      {item.type === "photo" ? (
        // トークン付き動的配信のため next/image は使わない
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${mediaBasePath}/${item.id}`}
          alt=""
          onClick={(event) => event.stopPropagation()}
          className="max-h-[86dvh] max-w-full rounded-md object-contain"
        />
      ) : (
        <video
          src={`${mediaBasePath}/${item.id}`}
          controls
          autoPlay
          playsInline
          onClick={(event) => event.stopPropagation()}
          className="max-h-[86dvh] max-w-full rounded-md bg-black"
        />
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute top-4 right-4 grid size-10 place-items-center rounded-full border border-border bg-surface/90 text-muted hover:border-accent hover:text-foreground"
      >
        <CloseIcon />
      </button>

      {hasPrevious && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            move(-1);
          }}
          aria-label="前の写真"
          className="absolute top-1/2 left-3 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface/90 text-muted hover:border-accent hover:text-foreground"
        >
          <ChevronIcon direction="left" />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            move(1);
          }}
          aria-label="次の写真"
          className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface/90 text-muted hover:border-accent hover:text-foreground"
        >
          <ChevronIcon direction="right" />
        </button>
      )}

      <p className="tabular absolute inset-x-0 bottom-5 text-center text-xs text-muted">
        {formatPointTime(item.taken_at)} · {index + 1} / {items.length}
      </p>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}
