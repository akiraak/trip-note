import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker デプロイ用(.next/standalone に自己完結サーバを出力)
  output: "standalone",
  // better-sqlite3 はネイティブモジュールのためバンドルせず require させる
  serverExternalPackages: ["better-sqlite3"],
  // 共有ページ(/share/[token])はログイン不要で開ける唯一の経路で、本番では
  // Cloudflare Access が /share/* だけを Bypass する。CSS・JS が既定の /_next/static/ から
  // 配られるとそこは Access の配下なので、ログインしていない人には資材だけログイン画面が返り、
  // 素の HTML になってしまう。**共有ページが要るものは全部 /share/ の下に置く**ことで
  // Bypass を 1 つに保つ(docs/plans/share-page-redesign.md)。
  // assetPrefix は URL の先頭を変えるだけなので、実体へ rewrite で戻す
  assetPrefix: "/share/_assets",
  async rewrites() {
    return [
      {
        source: "/share/_assets/_next/static/:path*",
        destination: "/_next/static/:path*",
      },
    ];
  },
};

export default nextConfig;
