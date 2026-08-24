"use client";

import { useState } from "react";
import { endTripAction } from "./actions";

// 旅行を終了する(iOS の TripDetailView「旅行を終了」相当)。進行中の旅行にだけ出す。
// delete-trip.tsx と同じ二段階確認の作法
export function EndTrip({ tripId }: { tripId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setPending(true);
    setError(null);
    const result = await endTripAction(tripId);
    if (result.ok) {
      // revalidatePath で新しい props が流れてくる(ボタン自体が消える)
      setConfirming(false);
      setPending(false);
      return;
    }
    setError(result.error);
    setPending(false);
  };

  return (
    <div className="mb-8 text-sm">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-danger">この旅行を終了しますか?</span>
          <button
            type="button"
            disabled={pending}
            onClick={run}
            className="font-medium text-danger underline disabled:opacity-50"
          >
            旅行を終了
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
          旅行を終了
        </button>
      )}
      <p className="mt-1 text-xs text-muted">
        記録の停止では旅行は終了しません。終了すると一覧で「進行中」ではなくなります。
      </p>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </div>
  );
}
