"use client";

import { useState } from "react";
import { issueShareLinkAction, revokeShareLinkAction, type ActionResult } from "./actions";

// 共有リンク(docs/plans/share-page.md)。発行するとログイン不要の /share/<token> で
// 工程と写真を見られる。停止すると即座に 404 になり、発行し直すと別の URL になる。
// 停止は end-trip.tsx と同じ二段階確認の作法
export function ShareLink({
  tripId,
  url,
}: {
  tripId: string;
  /** 発行済みの共有 URL(絶対。未発行なら null)。組み立ては page.tsx(リクエストの Host から) */
  url: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<ActionResult>) => {
    setPending(true);
    setError(null);
    const result = await action();
    if (!result.ok) {
      setError(result.error);
    }
    // 成功時は revalidatePath で新しい token が流れてくる
    setConfirming(false);
    setPending(false);
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("コピーできませんでした。URL を選択してコピーしてください");
    }
  };

  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="tabular text-[11px] tracking-[0.1em] text-muted uppercase">
        共有リンク
      </span>
      {url ? (
        <>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="tabular truncate text-xs text-accent hover:underline"
          >
            {url}
          </a>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              onClick={copy}
              className="text-accent hover:underline"
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
            {confirming ? (
              <>
                <span className="text-danger">
                  リンクを知っている人も見られなくなります
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => revokeShareLinkAction(tripId))}
                  className="font-medium text-danger underline disabled:opacity-50"
                >
                  共有を停止
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                  className="hover:underline"
                >
                  やめる
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-danger hover:underline"
              >
                共有を停止
              </button>
            )}
          </div>
          <p className="text-xs text-muted">
            ログイン不要。リンクを知っている人は誰でも工程と写真を見られます
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => issueShareLinkAction(tripId))}
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-raised disabled:opacity-50"
          >
            共有リンクを発行
          </button>
          <span className="text-xs text-muted">
            ログイン不要で工程と写真を見られる URL を作ります
          </span>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
