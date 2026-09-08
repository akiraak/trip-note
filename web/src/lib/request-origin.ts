import { headers } from "next/headers";

// 自分の origin(https://trip.chobi.me)。共有リンクの絶対 URL と OGP タグで使う。
// ブラウザ側で組むとハイドレーション前に出せず、OGP はそもそもサーバでしか作れないので、
// リクエストの Host から組む(本番は Cloudflare Tunnel が元の Host を通す)

export async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto")?.split(",")[0].trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}
