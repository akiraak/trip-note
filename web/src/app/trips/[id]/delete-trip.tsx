"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteTripAction } from "./actions";

// 旅行の削除(tombstone)。plan-section の削除 UI と同じ二段階確認の作法
export function DeleteTrip({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setPending(true);
    setError(null);
    const result = await deleteTripAction(tripId);
    if (result.ok) {
      router.push("/");
      return;
    }
    setError(result.error);
    setPending(false);
  };

  return (
    <div className="mt-12 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-red-600">
            プラン・記録・メディアごと削除します(iOS にも同期されます)
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={run}
            className="font-medium text-red-600 underline disabled:opacity-50"
          >
            本当に削除する
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
          className="text-red-600 underline"
        >
          この旅行を削除
        </button>
      )}
      {error && <p className="mt-2 text-red-600">{error}</p>}
    </div>
  );
}
