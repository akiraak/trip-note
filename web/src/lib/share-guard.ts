// /share/* の公開経路で受け付けるメソッド(src/proxy.ts が使う純ロジック)。
// 本番では /share/* だけが Cloudflare Access を Bypass する。Next.js の Server Action は
// 「どのページの URL への POST でも action id で実行される」ため、ここを素通しにすると
// 削除などの書き込み操作を無認証で叩けてしまう。閲覧に要る GET / HEAD 以外は 405 にする

export const SHARE_ALLOWED_METHODS: readonly string[] = ["GET", "HEAD"];

export function isShareMethodAllowed(method: string): boolean {
  return SHARE_ALLOWED_METHODS.includes(method.toUpperCase());
}

/** /share と /share/… (末尾スラッシュ・下位パスを含む) */
export function isSharePath(pathname: string): boolean {
  return pathname === "/share" || pathname.startsWith("/share/");
}
