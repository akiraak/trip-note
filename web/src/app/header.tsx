import Link from "next/link";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-border px-5 py-3">
      <Link href="/" className="font-semibold tracking-tight">
        旅ログ
      </Link>
      <Link
        href="/settings"
        className="tabular text-xs tracking-widest text-muted uppercase hover:text-foreground"
      >
        Settings
      </Link>
    </header>
  );
}
