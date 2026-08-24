"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteMediaAction } from "./actions";

// 写真・動画 1 件の削除。DeleteTrip / チェックポイントと同じ二段階確認の作法。
// サーバのファイルは消え、iOS のローカルからも次の同期(pull)で消える
export function DeleteMedia({
  tripId,
  mediaId,
}: {
  tripId: string;
  mediaId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setPending(true);
    setError(null);
    const result = await deleteMediaAction(tripId, mediaId);
    if (result.ok) {
      router.refresh();
      return;
    }
    setError(result.error);
    setPending(false);
  };

  return (
    <div className="text-[11px]">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={run}
            className="font-medium text-danger underline disabled:opacity-50"
          >
            本当に削除
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="underline"
          >
            やめる
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-danger underline"
        >
          削除
        </button>
      )}
      {error && <p className="mt-1 text-danger">{error}</p>}
    </div>
  );
}
