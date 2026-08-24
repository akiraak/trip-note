"use client";

import { useState, useTransition } from "react";
import { setAiModelAction } from "./actions";

export type ModelOption = {
  id: string;
  label: string;
  provider: string;
  pricing: string;
  note: string;
  keyConfigured: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
};

export function SettingsForm({
  models,
  currentId,
}: {
  models: ModelOption[];
  currentId: string;
}) {
  const [selected, setSelected] = useState(currentId);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  function save() {
    startTransition(async () => {
      const result = await setAiModelAction(selected);
      setMessage(
        result.ok
          ? { kind: "ok", text: "保存しました" }
          : { kind: "error", text: result.error },
      );
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {models.map((model) => (
          <label
            key={model.id}
            className="flex cursor-pointer items-start gap-3 p-3"
          >
            <input
              type="radio"
              name="ai-model"
              checked={selected === model.id}
              onChange={() => {
                setSelected(model.id);
                setMessage(null);
              }}
              className="mt-1"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{model.label}</span>
                <span className="text-xs text-muted">
                  {PROVIDER_LABELS[model.provider] ?? model.provider} ·{" "}
                  {model.pricing}
                </span>
                {!model.keyConfigured && (
                  <span className="text-xs text-amber-400">
                    API キー未設定
                  </span>
                )}
              </span>
              <span className="block text-sm text-muted">
                {model.note}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || selected === currentId}
          onClick={save}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </button>
        {message && (
          <p
            className={
              message.kind === "ok"
                ? "text-sm text-done"
                : "text-sm text-danger"
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
