"use client";

import { useActionState } from "react";
import { authenticate, type AuthState } from "./actions";

const initialState: AuthState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    authenticate,
    initialState,
  );

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-2xl font-semibold">trip-note</h1>
        <form action={formAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            メールアドレス
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            パスワード
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.info && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {state.info}
            </p>
          )}
          <button
            type="submit"
            name="intent"
            value="signin"
            disabled={pending}
            className="rounded bg-zinc-900 px-3 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            ログイン
          </button>
          <button
            type="submit"
            name="intent"
            value="signup"
            disabled={pending}
            className="rounded border border-zinc-300 px-3 py-2 font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            新規登録
          </button>
        </form>
      </div>
    </main>
  );
}
