import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker デプロイ用(.next/standalone に自己完結サーバを出力)
  output: "standalone",
  // better-sqlite3 はネイティブモジュールのためバンドルせず require させる
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
