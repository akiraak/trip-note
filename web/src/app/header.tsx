import Link from "next/link";
import { signOut } from "./login/actions";

export function Header({ email }: { email: string | null }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <Link href="/" className="font-semibold">
        trip-note
      </Link>
      <div className="flex items-center gap-3 text-sm">
        {email && (
          <span className="text-zinc-500 dark:text-zinc-400">{email}</span>
        )}
        <form action={signOut}>
          <button className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            ログアウト
          </button>
        </form>
      </div>
    </header>
  );
}
