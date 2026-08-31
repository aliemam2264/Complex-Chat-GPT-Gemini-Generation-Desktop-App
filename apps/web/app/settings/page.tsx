"use client";

import { useEffect, useState } from "react";

import { Bot, Banana, FileText, Gauge, LoaderCircle, Settings, SlidersHorizontal } from "lucide-react";

import { ProjectSidebar } from "@/components/projects/project-sidebar";
import { ProviderCard } from "@/components/settings/provider-card";
import { PromptPresetEditor } from "@/components/settings/prompt-preset-editor";

import { useGenerationDefaults } from "@/hooks/use-generation-defaults";
import {
  usePromptPresets,
  useResetPromptPreset,
  useSavePromptPreset,
} from "@/hooks/use-prompt-presets";

import {
  useGenerationRuntimeSettings,
  useUpdateGenerationRuntimeSettings,
} from "@/hooks/use-generation-runtime-settings";
import {
  useChatGPTStatus,
  useConnectChatGPTSettings,
  useConnectGeminiSettings,
  useGeminiStatus,
} from "@/hooks/use-provider-settings";

type ConcurrencyRowProps = {
  title: string;
  description: string;
  value: number | null;
  onChange: (value: number | null) => void;
  active: number;
  waiting: number;
  disabled?: boolean;
  last?: boolean;
};

const CONCURRENCY_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "Unlimited", value: null },
  { label: "1", value: 1 },
  { label: "2", value: 2 },
  { label: "3", value: 3 },
  { label: "4", value: 4 },
  { label: "6", value: 6 },
  { label: "8", value: 8 },
  { label: "12", value: 12 },
];

function ConcurrencyRow({ title, description, value, onChange, active, waiting, disabled, last }: ConcurrencyRowProps) {
  return (
    <div
      className={[
        "flex flex-wrap items-center justify-between gap-5 px-5 py-4",
        last ? "" : "border-b border-[var(--border)]",
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">{title}</p>
          <span className="rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[10px] text-[var(--foreground-subtle)]">
            {active} active
          </span>
          {waiting > 0 && (
            <span className="rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[10px] text-[var(--foreground-subtle)]">
              {waiting} waiting
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--foreground-muted)]">{description}</p>
      </div>

      <select
        value={value === null ? "unlimited" : String(value)}
        onChange={(event) => onChange(event.target.value === "unlimited" ? null : Number(event.target.value))}
        disabled={disabled}
        className="h-9 min-w-[132px] rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--foreground-subtle)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {CONCURRENCY_OPTIONS.map((option) => (
          <option
            key={option.value === null ? "unlimited" : option.value}
            value={option.value === null ? "unlimited" : String(option.value)}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function SettingsPage() {
  const geminiStatus = useGeminiStatus();
  const connectGemini = useConnectGeminiSettings();

  const { preserveMode, preserveEverythingElse, setPreserveMode, setPreserveEverythingElse } = useGenerationDefaults();

  const promptPresets = usePromptPresets();
  const savePromptPreset = useSavePromptPreset();
  const resetPromptPreset = useResetPromptPreset();

  const [waitingForGeminiLogin, setWaitingForGeminiLogin] = useState(false);

  const geminiState =
    geminiStatus.isLoading || geminiStatus.isFetching
      ? "checking"
      : geminiStatus.data?.connected
        ? "connected"
        : "disconnected";

  const chatGPTStatus = useChatGPTStatus();

  const connectChatGPT = useConnectChatGPTSettings();

  const [waitingForChatGPTLogin, setWaitingForChatGPTLogin] = useState(false);

  const runtimeSettings = useGenerationRuntimeSettings();
  const updateRuntimeSettings = useUpdateGenerationRuntimeSettings();

  const [promptLimit, setPromptLimit] = useState<number | null>(null);
  const [imageLimit, setImageLimit] = useState<number | null>(null);

  useEffect(() => {
    if (!runtimeSettings.data) {
      return;
    }

    setPromptLimit(runtimeSettings.data.promptMaxConcurrency);
    setImageLimit(runtimeSettings.data.imageMaxConcurrency);
  }, [runtimeSettings.data]);

  const runtimeDirty =
    runtimeSettings.data !== undefined &&
    (promptLimit !== runtimeSettings.data.promptMaxConcurrency ||
      imageLimit !== runtimeSettings.data.imageMaxConcurrency);

  async function handleSaveRuntimeSettings() {
    await updateRuntimeSettings.mutateAsync({
      promptMaxConcurrency: promptLimit,
      imageMaxConcurrency: imageLimit,
    });
  }

  const chatGPTState =
    chatGPTStatus.isLoading || chatGPTStatus.isFetching
      ? "checking"
      : chatGPTStatus.data?.connected
        ? "connected"
        : "disconnected";

  async function handleConnectGemini() {
    try {
      await connectGemini.mutateAsync();

      setWaitingForGeminiLogin(true);
    } catch (error) {
      console.error("Could not open Gemini:", error);
    }
  }

  async function handleCheckGeminiConnection() {
    try {
      const result = await geminiStatus.refetch();

      if (result.data?.connected) {
        setWaitingForGeminiLogin(false);
      }
    } catch (error) {
      console.error("Could not check Gemini connection:", error);
    }
  }

  async function handleConnectChatGPT() {
    try {
      await connectChatGPT.mutateAsync();

      setWaitingForChatGPTLogin(true);
    } catch (error) {
      console.error("Could not open ChatGPT:", error);
    }
  }

  async function handleCheckChatGPTConnection() {
    try {
      const result = await chatGPTStatus.refetch();

      if (result.data?.connected) {
        setWaitingForChatGPTLogin(false);
      }
    } catch (error) {
      console.error("Could not check ChatGPT connection:", error);
    }
  }

  async function handleSavePromptPreset(mode: Parameters<typeof setPreserveMode>[0], prompt: string) {
    await savePromptPreset.mutateAsync({ mode, prompt });
  }

  async function handleResetPromptPreset(mode: Parameters<typeof setPreserveMode>[0]) {
    await resetPromptPreset.mutateAsync(mode);
  }

  const promptPresetError = savePromptPreset.error ?? resetPromptPreset.error ?? promptPresets.error;

  return (
    <main className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <ProjectSidebar />

      <section className="min-w-0 flex-1 overflow-y-auto">
        {/* Header */}
        <header className="flex min-h-17 items-center border-b border-[var(--border)] px-7">
          <div className="flex items-center gap-3">
            <Settings size={18} strokeWidth={1.8} />

            <div>
              <h1 className="text-sm font-medium">Settings</h1>

              <p className="mt-0.5 text-xs text-[var(--foreground-subtle)]">Configure Eskander Plus Studio</p>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-4xl px-7 py-8">
          {/* General */}
          <section>
            <div className="mb-4 flex items-center gap-2">
              <SlidersHorizontal size={15} strokeWidth={1.8} className="text-[var(--foreground-muted)]" />

              <h2 className="text-sm font-medium">General</h2>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
              {/* Preserve Mode */}
              <div className="flex flex-wrap items-center justify-between gap-5 border-b border-[var(--border)] px-5 py-4">
                <div>
                  <p className="text-sm">Default Preserve Mode</p>

                  <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                    Default behavior when starting a new image edit.
                  </p>
                </div>

                <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--background)] p-1">
                  {(["STRICT", "BALANCED", "CREATIVE", "NO_RESTRICTION"] as const).map((mode) => {
                    const active = preserveMode === mode;

                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPreserveMode(mode)}
                        className={[
                          "h-8 rounded-lg px-3.5 text-[11px] font-medium transition-colors",
                          active
                            ? "bg-[var(--foreground)] text-[var(--background)]"
                            : "text-[var(--foreground-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]",
                        ].join(" ")}
                      >
                        {mode === "NO_RESTRICTION" ? "No Restriction" : mode.charAt(0) + mode.slice(1).toLowerCase()}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preserve Everything */}
              <div className="flex items-center justify-between gap-5 px-5 py-4">
                <div>
                  <p className="text-sm">Preserve Everything Else</p>

                  <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                    {preserveMode === "NO_RESTRICTION"
                      ? "Ignored while No Restriction is selected."
                      : "Keep unrelated parts of the render unchanged by default."}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={preserveMode === "NO_RESTRICTION" ? false : preserveEverythingElse}
                  onClick={() => setPreserveEverythingElse(!preserveEverythingElse)}
                  disabled={preserveMode === "NO_RESTRICTION"}
                  className={[
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                    preserveMode !== "NO_RESTRICTION" && preserveEverythingElse
                      ? "bg-emerald-500"
                      : "bg-[var(--surface-3)]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                      preserveMode !== "NO_RESTRICTION" && preserveEverythingElse ? "translate-x-[22px]" : "translate-x-0.5",
                    ].join(" ")}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* Prompt Presets */}
          <section className="mt-10">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <FileText size={15} strokeWidth={1.8} className="text-[var(--foreground-muted)]" />
                  <h2 className="text-sm font-medium">Prompt Presets</h2>
                </div>

                <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--foreground-muted)]">
                  Customize the instruction Eskander adds for each edit mode. Reset to Default removes the user
                  override and immediately returns that mode to its hardcoded prompt.
                </p>
              </div>
            </div>

            {promptPresets.isLoading ? (
              <div className="flex min-h-28 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
                <LoaderCircle size={16} strokeWidth={1.8} className="animate-spin text-[var(--foreground-muted)]" />
              </div>
            ) : (
              <div className="space-y-3">
                {promptPresets.data?.presets.map((preset) => (
                  <PromptPresetEditor
                    key={preset.mode}
                    preset={preset}
                    saving={savePromptPreset.isPending && savePromptPreset.variables?.mode === preset.mode}
                    resetting={resetPromptPreset.isPending && resetPromptPreset.variables === preset.mode}
                    onSave={(prompt) => handleSavePromptPreset(preset.mode, prompt)}
                    onReset={() => handleResetPromptPreset(preset.mode)}
                  />
                ))}
              </div>
            )}

            {promptPresetError && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-500">
                {promptPresetError instanceof Error
                  ? promptPresetError.message
                  : "Could not update prompt presets."}
              </div>
            )}
          </section>

          {/* Generation Performance */}
          <section className="mt-10">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Gauge size={15} strokeWidth={1.8} className="text-[var(--foreground-muted)]" />
                  <h2 className="text-sm font-medium">Generation Performance</h2>
                </div>

                <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">
                  Control how many browser generations may run at the same time. Unlimited keeps the current
                  fully-parallel behavior.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSaveRuntimeSettings}
                disabled={!runtimeDirty || updateRuntimeSettings.isPending}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--foreground)] px-4 text-xs font-medium text-[var(--background)] transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
              >
                {updateRuntimeSettings.isPending && (
                  <LoaderCircle size={14} strokeWidth={1.8} className="animate-spin" />
                )}
                {updateRuntimeSettings.isPending ? "Saving..." : "Save"}
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
              <ConcurrencyRow
                title="ChatGPT prompt jobs"
                description="Maximum simultaneous ChatGPT browser tabs used for prompt refinement."
                value={promptLimit}
                onChange={setPromptLimit}
                active={runtimeSettings.data?.runtime.chatgpt.active ?? 0}
                waiting={runtimeSettings.data?.runtime.chatgpt.waiting ?? 0}
                disabled={runtimeSettings.isLoading || updateRuntimeSettings.isPending}
              />

              <ConcurrencyRow
                title="Gemini image jobs"
                description="Maximum simultaneous Gemini browser tabs used for image generation."
                value={imageLimit}
                onChange={setImageLimit}
                active={runtimeSettings.data?.runtime.gemini.active ?? 0}
                waiting={runtimeSettings.data?.runtime.gemini.waiting ?? 0}
                disabled={runtimeSettings.isLoading || updateRuntimeSettings.isPending}
                last
              />
            </div>

            <p className="mt-3 text-xs leading-5 text-[var(--foreground-subtle)]">
              Changing a limit never cancels jobs that are already running. If you choose a limit and all slots are
              busy, new jobs wait until a slot becomes free.
            </p>

            {updateRuntimeSettings.isError && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-500">
                {updateRuntimeSettings.error instanceof Error
                  ? updateRuntimeSettings.error.message
                  : "Could not save generation performance settings."}
              </div>
            )}
          </section>

          {/* AI Providers */}
          <section className="mt-10">
            <div className="mb-4">
              <h2 className="text-sm font-medium">AI Providers</h2>

              <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                Services used for prompt refinement and image generation.
              </p>
            </div>

            <div className="space-y-3">
              {/* Gemini */}
              <ProviderCard
                icon={Banana}
                name="Gemini / Nano Banana"
                description="Used to generate and edit architectural render images."
                status={geminiState}
                actionLabel={
                  waitingForGeminiLogin ? "Check connection" : geminiStatus.data?.connected ? "Reconnect" : "Connect"
                }
                actionLoading={connectGemini.isPending}
                onAction={waitingForGeminiLogin ? handleCheckGeminiConnection : handleConnectGemini}
              />

              {/* ChatGPT */}
              <ProviderCard
                icon={Bot}
                name="ChatGPT"
                description="Analyzes the selected render and turns your instruction into a production-ready architectural prompt."
                status={chatGPTState}
                actionLabel={
                  waitingForChatGPTLogin ? "Check connection" : chatGPTStatus.data?.connected ? "Reconnect" : "Connect"
                }
                actionLoading={connectChatGPT.isPending}
                onAction={waitingForChatGPTLogin ? handleCheckChatGPTConnection : handleConnectChatGPT}
              />
            </div>

            {/* ChatGPT Login Message */}
            {waitingForChatGPTLogin && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-xs leading-5 text-[var(--foreground-muted)]">
                Sign in to ChatGPT in the opened Chrome window, then close Chrome and click{" "}
                <span className="font-medium text-[var(--foreground)]">Check connection</span>.
              </div>
            )}

            {/* Gemini Login Message */}
            {waitingForGeminiLogin && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-xs leading-5 text-[var(--foreground-muted)]">
                Sign in to Gemini in the opened Chrome window, then close Chrome and click{" "}
                <span className="font-medium text-[var(--foreground)]">Check connection</span>.
              </div>
            )}

            {/* Gemini Error */}
            {geminiStatus.isError && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-500">
                Could not check Gemini connection.
              </div>
            )}

            {/* Connect Error */}
            {connectGemini.isError && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-500">
                {connectGemini.error instanceof Error
                  ? connectGemini.error.message
                  : "Could not open Gemini connection."}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
