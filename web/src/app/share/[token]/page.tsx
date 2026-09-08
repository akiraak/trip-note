import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareView } from "./share-view";
import { requestOrigin } from "@/lib/request-origin";
import { readShareMeta, readSharedTrip } from "@/lib/share";
import { shareSummaryLine } from "@/lib/share-summary";

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
  const meta = readShareMeta(token);
  const common = {
    // 推測できない URL を検索エンジンに拾わせない
    robots: { index: false, follow: false } as const,
    // アイコンも /share/ の下から配る。既定の /icon.png は Access の配下なので、
    // ログインしていない人には届かない(このページが要るものは全部 /share/ に置く)
    icons: { icon: "/share/icon.png" },
  };
  if (!meta) {
    return { title: "旅ログ", ...common };
  }
  // チャットに貼ったときのプレビュー(OGP)。画像は旅行の最初の写真で、配信元の
  // /share/<token>/media/<id> は Access を通さないのでプレビューを作る側から取れる
  const origin = await requestOrigin();
  const url = `${origin}/share/${token}`;
  const title = `${meta.title} | 旅ログ`;
  const description = shareSummaryLine(meta);
  const images = meta.coverMediaId
    ? [{ url: `${origin}/share/${token}/media/${meta.coverMediaId}`, alt: meta.title }]
    : [];
  return {
    title,
    ...common,
    metadataBase: new URL(origin),
    openGraph: {
      type: "article",
      siteName: "旅ログ",
      title,
      description,
      url,
      images,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      description,
      images,
    },
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
