import { Header } from "../header";
import { SettingsForm, type ModelOption } from "./settings-form";
import { AI_MODELS, getAiModel, hasApiKey } from "@/lib/ai";

export const dynamic = "force-dynamic";

// AI モデルの設定画面。許可リスト(lib/ai.ts)から選択して app_settings に保存する。
// API キーはサーバの環境変数のみで、ここでは設定済みかどうかだけ表示する

export default function SettingsPage() {
  const current = getAiModel();
  const models: ModelOption[] = AI_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    provider: model.provider,
    pricing: model.pricing,
    note: model.note,
    keyConfigured: hasApiKey(model.provider),
  }));
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-xl font-semibold">設定</h1>
        <h2 className="mb-2 font-medium">AI モデル</h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          行程提案で使うモデル。iOS からの利用にも適用されます。
          価格は $/1M トークン(入力/出力)。
        </p>
        <SettingsForm models={models} currentId={current.id} />
      </main>
    </>
  );
}
