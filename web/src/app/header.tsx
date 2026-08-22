import Link from "next/link";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <Link href="/" className="font-semibold">
        旅ログ
      </Link>
      <Link
        href="/settings"
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
      >
        設定
      </Link>
    </header>
  );
}
