import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareView } from "./share-view";
import { findSharedTrip, readSharedTrip } from "@/lib/share";

// 共有ページ(docs/plans/share-page.md、デザインは docs/plans/share-page-redesign.md)。
// ログイン不要で、共有リンクのトークンが一致する旅行の地図と写真を閲覧専用で見せる。
// 本番では /share/* だけが Cloudflare Access を Bypass する
// (GET / HEAD 以外は src/proxy.ts が 405 にする)

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
    // アイコンも /share/ の下から配る。既定の /icon.png は Access の配下なので、
    // ログインしていない人には届かない(このページが要るものは全部 /share/ に置く)
    icons: { icon: "/share/icon.png" },
  };
}

export default async function SharePage(props: PageProps<"/share/[token]">) {
  const { token } = await props.params;
  const shared = readSharedTrip(token);
  if (!shared) {
    notFound();
  }
  // 写真・動画はそのトークンの旅行のものだけを返す配信から取る
  return <ShareView shared={shared} mediaBasePath={`/share/${token}/media`} />;
}
