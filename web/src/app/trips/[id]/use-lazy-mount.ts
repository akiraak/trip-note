"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/// 画面に近づいたら true、1 画面分以上離れたら false になる。
/// 地図は 1 枚につき WebGL コンテキストを 1 つ使い、ブラウザの上限(概ね 16)を超えると
/// 古い地図が白く抜ける。日数の多い旅行でも同時に生きる地図を数枚に抑えるために使う
/// (候補地図を先頭 3 件に絞ったのと同じ問題: docs/plans/archive/web-outline-candidate-map.md)。
/// 返す ref は高さの決まったプレースホルダに付けること(未マウント時に潰れると再表示できない)。
/// SSR とハイドレーション直後は必ず false(サーバ側に IntersectionObserver が無いため)。
export function useLazyMount<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  visible: boolean;
} {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      // 素早いスクロールでは 1 回のコールバックに複数の記録がまとまって届く。
      // 先頭を見ると途中の状態を掴んでしまうので必ず最後(= 現在の状態)を使う
      (entries) => setVisible(entries[entries.length - 1].isIntersecting),
      // 1 画面分手前でマウントし、1 画面分以上離れたらアンマウントする
      { rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}
