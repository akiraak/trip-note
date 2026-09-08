// 共有ページの「期間 · 日数 · 写真の枚数」の 1 行。
// 画面(share-view.tsx)と OGP の説明文(page.tsx の generateMetadata)で同じ文面を使うため、
// サーバ・クライアントのどちらからも読める純関数として置く(DB にも next/headers にも触らない)

export type ShareSummary = {
  /** プランの最初の日 YYYY-MM-DD。日が無ければ null */
  firstDate: string | null;
  /** プランの最後の日 YYYY-MM-DD */
  lastDate: string | null;
  dayCount: number;
  photoCount: number;
  videoCount: number;
};

/** 「2026/09/01 – 09/03 · 3日間 · 写真 12 枚」。出せる項目が無ければ空文字 */
export function shareSummaryLine(summary: ShareSummary): string {
  const parts: string[] = [];
  if (summary.firstDate && summary.lastDate) {
    const first = summary.firstDate.replace(/-/g, "/");
    // 2 日目以降は月日だけにする(同じ年を 2 回書かない)
    const last = summary.lastDate.slice(5).replace(/-/g, "/");
    parts.push(summary.firstDate === summary.lastDate ? first : `${first} – ${last}`);
  }
  if (summary.dayCount > 0) {
    parts.push(`${summary.dayCount}日間`);
  }
  const total = summary.photoCount + summary.videoCount;
  if (total > 0) {
    // 動画が混ざっていれば「件」、写真だけなら「枚」
    parts.push(summary.videoCount === 0 ? `写真 ${total} 枚` : `写真・動画 ${total} 件`);
  }
  return parts.join(" · ");
}
