"use client";

import { useEffect, useRef, useState } from "react";
import { resolveRouteLegsAction } from "./route-actions";
import { legKey, type Leg, type ResolvedLeg } from "@/lib/route-legs";

// 日別地図・トップ地図・日カードの距離表示が共有するレグ解決。
//
// - 解決済みはモジュールスコープにキャッシュする。日別地図は遅延マウント/アンマウント
//   するので、スクロールで戻ってきたときに取り直さないため
// - 未解決キーは 1 本のキューにまとめ、8 件ずつ順に Server Action へ投げる。
//   OSRM はサーバ側で直列 + 最小 1 秒間隔なので、全件そろうまで待つと初回に数十秒
//   何も変わらない。チャンクごとに購読者へ通知して直線から順に道路形状へ差し替える
// - 走るリクエストは常に 1 本(地図の枚数だけ Server Action を投げない)。
//   Next.js はクライアントごとに Server Action を直列にディスパッチするので、
//   ここで束ねておかないと編集操作のアクションが長く待たされる

/** 1 回の Server Action で解決するレグ数(サーバ上限 50 より十分小さく取る) */
const CHUNK_SIZE = 8;

const cache = new Map<string, ResolvedLeg>();
/** 解決待ちのレグ(キー重複なし)。取得中のキーは pending へ移す */
const queue = new Map<string, Leg>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let draining = false;

/** キャッシュ済み(= SSR で渡された分を含む)のレグを覚える */
function seed(legs: Record<string, ResolvedLeg>) {
  for (const [key, leg] of Object.entries(legs)) {
    if (!cache.has(key)) {
      cache.set(key, leg);
    }
  }
}

/** legs のうち解決済みのものを集める。extra は cache へ入れる前の SSR 分 */
function lookup(
  legs: Leg[],
  extra?: Record<string, ResolvedLeg>,
): Record<string, ResolvedLeg> {
  const found: Record<string, ResolvedLeg> = {};
  for (const leg of legs) {
    const key = legKey(leg.from, leg.to);
    const hit = cache.get(key) ?? extra?.[key];
    if (hit) {
      found[key] = hit;
    }
  }
  return found;
}

function enqueue(legs: Leg[]) {
  let added = false;
  for (const leg of legs) {
    const key = legKey(leg.from, leg.to);
    if (cache.has(key) || pending.has(key) || queue.has(key)) continue;
    queue.set(key, leg);
    added = true;
  }
  if (added) {
    void drain();
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.size > 0) {
      const chunk = [...queue.entries()].slice(0, CHUNK_SIZE);
      for (const [key] of chunk) {
        queue.delete(key);
        pending.add(key);
      }
      try {
        const resolved = await resolveRouteLegsAction(
          chunk.map(([, leg]) => leg),
        );
        seed(resolved);
      } catch (error) {
        // 解決できなかったレグは直線のまま描かれる。キャッシュに入れないので
        // 次にそのレグが必要になったとき(再マウント・編集後)に再試行される
        console.error("[useRouteLegs] レグの解決に失敗:", error);
      } finally {
        for (const [key] of chunk) {
          pending.delete(key);
        }
      }
      for (const listener of listeners) {
        listener();
      }
    }
  } finally {
    draining = false;
  }
}

/// レグ列を「レグキー → 解決済みレグ」に解決する。未解決のキーは含まれないので、
/// 呼び出し側は直線でフォールバックする(legLines / totalLegMeters がその形)
export function useRouteLegs(
  legs: Leg[],
  /** SSR で渡された解決済みレグ(page.tsx の readCachedLegs)。取りに行かずに使う */
  prefilled?: Record<string, ResolvedLeg>,
): Record<string, ResolvedLeg> {
  // legs / prefilled は毎レンダー別物になり得るので、effect の依存には
  // キー列(= 区間の並び)を使い、中身は ref 経由で読む
  const legsRef = useRef(legs);
  const prefilledRef = useRef(prefilled);
  // 下の effect より先に宣言しているので、同じコミットでは必ずこちらが先に走る
  useEffect(() => {
    legsRef.current = legs;
    prefilledRef.current = prefilled;
  });
  const signature = legs.map((leg) => legKey(leg.from, leg.to)).join("|");
  // SSR とハイドレーション直後はサーバから渡された分だけで描く
  // (cache はクライアント専用。SSR 中に書くとリクエスト間で共有されてしまう)
  const [resolved, setResolved] = useState<Record<string, ResolvedLeg>>(() =>
    lookup(legs, prefilled),
  );

  useEffect(() => {
    if (prefilledRef.current) {
      seed(prefilledRef.current);
    }
    const update = () => setResolved(lookup(legsRef.current));
    listeners.add(update);
    update();
    enqueue(legsRef.current);
    return () => {
      listeners.delete(update);
    };
  }, [signature]);

  return resolved;
}
