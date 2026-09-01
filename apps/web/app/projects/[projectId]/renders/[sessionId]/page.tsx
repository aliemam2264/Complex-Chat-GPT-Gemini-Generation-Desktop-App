"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";

import { useGenerationActivityStore } from "@/stores/use-generation-activity-store";

import { ImagePlus, X, ArrowLeft, Check, Copy, Download, LoaderCircle, Trash2 } from "lucide-react";

import { ProjectSidebar } from "@/components/projects/project-sidebar";
import { PromptModal } from "@/components/workspace/prompt-modal";
import { GenerationHistoryPanel } from "@/components/generation/generation-history-panel";
import { VersionTreePanel } from "@/components/generation/version-tree-panel";

import { useCreatePrompt } from "@/hooks/use-prompt-generation";
import { useGenerationDefaults } from "@/hooks/use-generation-defaults";
import { useGenerationStatus } from "@/hooks/use-generation-status";
import { useImageActions } from "@/hooks/use-image-actions";
import { useDeleteVersions } from "@/hooks/use-delete-versions";

import { apiGet, getAssetUrl } from "@/lib/api";

import type { GenerationRun } from "@/types/generation";
import type { Asset, ImageSession } from "@/types/project";

type ReferenceImageItem = {
  id: string;
  file: File;
  previewUrl: string;
};

export default function RenderWorkspacePage() {
  const referenceInputRef = useRef<HTMLInputElement>(null);

  const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);

  const [referenceError, setReferenceError] = useState<string | null>(null);

  const referenceImagesRef = useRef<ReferenceImageItem[]>([]);

  useEffect(() => {
    referenceImagesRef.current = referenceImages;
  }, [referenceImages]);

  useEffect(() => {
    return () => {
      for (const item of referenceImagesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const queryClient = useQueryClient();
  const router = useRouter();

  const addBackgroundGeneration = useGenerationActivityStore((state) => state.addBackgroundGeneration);

  const params = useParams<{
    projectId: string;
    sessionId: string;
  }>();

  const imageActions = useImageActions();

  const createPrompt = useCreatePrompt();

  const deleteVersions = useDeleteVersions(params.projectId, params.sessionId);

  const { preserveMode, preserveEverythingElse, setPreserveMode, setPreserveEverythingElse } = useGenerationDefaults();

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const [instruction, setInstruction] = useState("");

  const [promptModalOpen, setPromptModalOpen] = useState(false);

  const [generation, setGeneration] = useState<GenerationRun | null>(null);

  const [activeGenerationId, setActiveGenerationId] = useState<string | null>(null);

  const [startingPrompt, setStartingPrompt] = useState(false);

  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);

  const [versionView, setVersionView] = useState<"STRIP" | "TREE">("STRIP");

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["image-session", params.sessionId],

    queryFn: () => apiGet<ImageSession>(`/api/projects/${params.projectId}/image-sessions/${params.sessionId}`),
  });

  const session = sessionQuery.data;

  const original = useMemo(() => session?.assets.find((asset) => asset.type === "ORIGINAL"), [session]);

  useEffect(() => {
    if (!selectedSourceId && original) {
      setSelectedSourceId(original.id);
    }
  }, [original, selectedSourceId]);

  const generatedAssets = useMemo(() => session?.assets.filter((asset) => asset.type === "GENERATED") ?? [], [session]);

  const versionAssets = useMemo(
    () => session?.assets.filter((asset) => asset.type === "ORIGINAL" || asset.type === "GENERATED") ?? [],
    [session],
  );

  const selectedSource = versionAssets.find((asset) => asset.id === selectedSourceId) ?? null;

  const selectedVersionAssets = useMemo(
    () => generatedAssets.filter((asset) => selectedVersionIds.includes(asset.id)),
    [generatedAssets, selectedVersionIds],
  );

  const allGeneratedSelected = generatedAssets.length > 0 && selectedVersionIds.length === generatedAssets.length;

  useEffect(() => {
    if (!session) {
      return;
    }

    const generatedIds = new Set(session.assets.filter((asset) => asset.type === "GENERATED").map((asset) => asset.id));

    setSelectedVersionIds((current) => {
      const next = current.filter((id) => generatedIds.has(id));

      return next.length === current.length ? current : next;
    });
  }, [session]);

  useEffect(() => {
    if (!selectedSourceId || !versionAssets.length) {
      return;
    }

    if (!versionAssets.some((asset) => asset.id === selectedSourceId)) {
      setSelectedSourceId(original?.id ?? versionAssets[0]?.id ?? null);
    }
  }, [original?.id, selectedSourceId, versionAssets]);

  /*
   * Poll active generation while ChatGPT is working.
   */
  const generationStatus = useGenerationStatus(activeGenerationId);

  const handledOutputAssetId = useRef<string | null>(null);
  /*
   * Prefer the latest version from polling.
   *
   * Immediately after POST /prompts we still have the
   * generation returned from createPrompt, so the modal
   * doesn't need to wait for the first polling request.
   */
  const liveGeneration = generationStatus.data ?? generation;

  /*
   * Keep local generation in sync with polling.
   *
   * PromptModal can therefore keep using its existing
   * `generation` prop.
   */
  useEffect(() => {
    if (!generationStatus.data) {
      return;
    }

    setGeneration(generationStatus.data);
  }, [generationStatus.data]);

  useEffect(() => {
    const current = generationStatus.data;

    if (current?.status !== "COMPLETED" || !current.outputAssetId) {
      return;
    }

    /*
     * Don't process the same completion twice
     * because polling/query updates can re-render.
     */
    if (handledOutputAssetId.current === current.outputAssetId) {
      return;
    }

    handledOutputAssetId.current = current.outputAssetId;

    void (async () => {
      /*
       * Pull the new GENERATED asset
       * into the Versions rail.
       */
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["image-session", params.sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["generation-history", params.projectId, params.sessionId],
        }),
      ]);

      /*
       * Automatically select the freshly
       * generated version.
       */
      setSelectedSourceId(current.outputAssetId);
    })();
  }, [generationStatus.data, params.sessionId, queryClient]);

  const promptIsRunning =
    startingPrompt || liveGeneration?.status === "PENDING" || liveGeneration?.status === "PROMPTING";

  function getVersionLabel(asset: Asset) {
    if (asset.type === "ORIGINAL") {
      return "Original";
    }

    const generated = generatedAssets;

    const index = generated.findIndex((item) => item.id === asset.id);

    return `V${index + 1}`;
  }

  function openReferencePicker() {
    if (referenceImages.length >= 5) {
      setReferenceError("You can add up to 5 reference images.");

      return;
    }

    referenceInputRef.current?.click();
  }

  function handleReferenceImages(files: FileList | null) {
    if (!files) {
      return;
    }

    const incoming = Array.from(files);

    const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

    const validImages: File[] = [];

    for (const file of incoming) {
      if (!supportedTypes.has(file.type)) {
        setReferenceError("Only JPG, PNG and WebP reference images are supported.");

        continue;
      }

      if (file.size > 50 * 1024 * 1024) {
        setReferenceError(`${file.name} is larger than 50 MB.`);

        continue;
      }

      validImages.push(file);
    }

    const availableSlots = 5 - referenceImages.length;

    if (availableSlots <= 0) {
      setReferenceError("You can add up to 5 reference images.");

      return;
    }

    const imagesToAdd = validImages.slice(0, availableSlots);

    if (validImages.length > availableSlots) {
      setReferenceError("Only the first 5 reference images were added.");
    } else {
      setReferenceError(null);
    }

    const items: ReferenceImageItem[] = imagesToAdd.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setReferenceImages((current) => [...current, ...items]);
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((current) => {
      const target = current.find((item) => item.id === id);

      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((item) => item.id !== id);
    });

    setReferenceError(null);
  }

  async function handleBuildPrompt() {
    const trimmedInstruction = instruction.trim();

    if (!selectedSourceId || !trimmedInstruction) {
      return;
    }

    /*
     * Open immediately.
     *
     * The user should see the modal before ChatGPT starts
     * instead of waiting for the whole operation.
     */
    setPromptModalOpen(true);

    /*
     * Reset previous active prompt.
     */
    setGeneration(null);
    setActiveGenerationId(null);
    setStartingPrompt(true);

    try {
      /*
       * This API now returns 202 immediately.
       * ChatGPT itself runs in the background.
       */
      const result = await createPrompt.mutateAsync({
        projectId: params.projectId,

        sessionId: params.sessionId,

        sourceAssetId: selectedSourceId,

        instruction: trimmedInstruction,

        preserveMode,

        preserveEverythingElse,

        referenceImages: referenceImages.map((item) => item.file),
      });

      /*
       * Show the new generation immediately.
       */
      setGeneration(result);

      for (const item of referenceImages) {
        URL.revokeObjectURL(item.previewUrl);
      }

      setReferenceImages([]);
      setReferenceError(null);

      /*
       * Start polling:
       *
       * CHATGPT_STARTING
       * → CHATGPT_UPLOADING_IMAGE
       * → CHATGPT_WAITING_RESPONSE
       * → PROMPT_READY
       */
      setActiveGenerationId(result.id);
    } catch (error) {
      console.error("Could not start prompt generation:", error);

      /*
       * Don't leave an empty modal open if the request
       * itself could not create a GenerationRun.
       */
      setPromptModalOpen(false);
    } finally {
      setStartingPrompt(false);
    }
  }

  function handlePromptModalClose() {
    if (
      activeGenerationId &&
      (liveGeneration?.status === "PENDING" ||
        liveGeneration?.status === "PROMPTING" ||
        liveGeneration?.status === "PROMPT_READY")
    ) {
      addBackgroundGeneration(activeGenerationId);
    }

    setPromptModalOpen(false);
  }

  function handleGenerationChange(updatedGeneration: GenerationRun) {
    setGeneration(updatedGeneration);

    setActiveGenerationId(updatedGeneration.id);

    /*
     * Important:
     * Update React Query immediately.
     *
     * This makes polling restart as soon as
     * status changes from PROMPT_READY → GENERATING.
     */
    queryClient.setQueryData(["generation", updatedGeneration.id], updatedGeneration);
  }

  function toggleVersionSelection(assetId: string) {
    setSelectedVersionIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  }

  function toggleSelectAllVersions() {
    if (allGeneratedSelected) {
      setSelectedVersionIds([]);
      return;
    }

    setSelectedVersionIds(generatedAssets.map((asset) => asset.id));
  }

  function openDeleteVersionsModal() {
    if (selectedVersionIds.length === 0) {
      return;
    }

    setDeleteError(null);
    setDeleteModalOpen(true);
  }

  function closeDeleteVersionsModal() {
    if (deleteVersions.isPending) {
      return;
    }

    setDeleteError(null);
    setDeleteModalOpen(false);
  }

  useEffect(() => {
    if (!deleteModalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleteVersions.isPending) {
        setDeleteError(null);
        setDeleteModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteModalOpen, deleteVersions.isPending]);

  async function handleDeleteSelectedVersions() {
    if (!session || selectedVersionIds.length === 0) {
      return;
    }

    const idsToDelete = [...selectedVersionIds];
    const idsToDeleteSet = new Set(idsToDelete);

    let fallbackSourceId: string | null = selectedSourceId;

    if (selectedSourceId && idsToDeleteSet.has(selectedSourceId)) {
      const selectedIndex = versionAssets.findIndex((asset) => asset.id === selectedSourceId);

      const previousAsset = versionAssets
        .slice(0, Math.max(0, selectedIndex))
        .reverse()
        .find((asset) => !idsToDeleteSet.has(asset.id));

      const nextAsset = versionAssets.slice(selectedIndex + 1).find((asset) => !idsToDeleteSet.has(asset.id));

      fallbackSourceId = previousAsset?.id ?? nextAsset?.id ?? original?.id ?? null;
    }

    setDeleteError(null);

    try {
      const result = await deleteVersions.mutateAsync(idsToDelete);
      const deletedIds = new Set(result.deletedAssetIds);

      setSelectedVersionIds((current) => current.filter((id) => !deletedIds.has(id)));

      if (selectedSourceId && deletedIds.has(selectedSourceId)) {
        setSelectedSourceId(fallbackSourceId);
      }

      await queryClient.invalidateQueries({
        queryKey: ["generation-history", params.projectId, params.sessionId],
      });

      setDeleteModalOpen(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete the selected versions.");
    }
  }

  if (sessionQuery.isLoading) {
    return (
      <main className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
        <ProjectSidebar />

        <div className="flex flex-1 items-center justify-center text-sm text-[var(--foreground-muted)]">
          Loading render...
        </div>
      </main>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <main className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
        <ProjectSidebar />

        <div className="flex flex-1 items-center justify-center text-sm text-[var(--danger)]">
          Could not load render.
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
        <ProjectSidebar />

        <section className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="flex min-h-[68px] shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-7">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push(`/projects/${params.projectId}`)}
                title="Back"
                aria-label="Back to renders"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <ArrowLeft size={18} strokeWidth={1.8} />
              </button>

              <div>
                <h1 className="text-sm font-medium">{session.name}</h1>

                <p className="mt-1 text-xs text-[var(--foreground-subtle)]">Render Workspace</p>
              </div>
            </div>

            <div className="text-xs text-[var(--foreground-muted)]">
              {versionAssets.length} {versionAssets.length === 1 ? "version" : "versions"}
            </div>
          </header>

          {/* Scrollable Workspace */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1280px] px-6 py-6">
              {/* Main Workspace Card */}
              <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)]">
                {/* Image Viewer */}
                <div className="group relative flex min-h-[500px] items-center justify-center bg-[#070707] p-6">
                  {selectedSource && (
                    <>
                      {/* Image Actions */}
                      <div className="absolute right-4 top-4 z-10 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => imageActions.copyImage(getAssetUrl(selectedSource.filePath))}
                          disabled={imageActions.status !== "idle"}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/60 px-3.5 text-xs text-white backdrop-blur-md transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Copy size={14} strokeWidth={1.8} />

                          <span>{imageActions.status === "copying" ? "Copying..." : "Copy Image"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            imageActions.saveImage(getAssetUrl(selectedSource.filePath), selectedSource.fileName)
                          }
                          disabled={imageActions.status !== "idle"}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white px-3.5 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Download size={14} strokeWidth={1.8} />

                          <span>{imageActions.status === "saving" ? "Saving..." : "Save Image"}</span>
                        </button>
                      </div>

                      {/* Feedback */}
                      {imageActions.message && (
                        <div className="absolute bottom-4 right-4 z-10 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-xs text-white backdrop-blur-md">
                          {imageActions.message}
                        </div>
                      )}

                      <img
                        src={getAssetUrl(selectedSource.filePath)}
                        alt=""
                        className="max-h-[650px] max-w-full object-contain"
                      />
                    </>
                  )}
                </div>

                {/* Versions */}
                <div className="border-t border-[var(--border)] px-5 py-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--foreground-subtle)]">Versions</p>

                      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-1">
                        <button
                          type="button"
                          onClick={() => setVersionView("STRIP")}
                          className={[
                            "rounded-md px-2.5 py-1 text-xs transition-colors",
                            versionView === "STRIP"
                              ? "bg-[var(--surface-2)] text-[var(--foreground)]"
                              : "text-[var(--foreground-subtle)] hover:text-[var(--foreground)]",
                          ].join(" ")}
                        >
                          Strip
                        </button>

                        <button
                          type="button"
                          onClick={() => setVersionView("TREE")}
                          className={[
                            "rounded-md px-2.5 py-1 text-xs transition-colors",
                            versionView === "TREE"
                              ? "bg-[var(--surface-2)] text-[var(--foreground)]"
                              : "text-[var(--foreground-subtle)] hover:text-[var(--foreground)]",
                          ].join(" ")}
                        >
                          Tree
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/projects/${params.projectId}/renders/${params.sessionId}/flow`,
                            )
                          }
                          className="rounded-md px-2.5 py-1 text-xs text-[var(--foreground-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                        >
                          Flow
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <p className="mr-1 text-sm text-[var(--foreground-muted)]">Choose source</p>

                      {generatedAssets.length > 0 && (
                        <button
                          type="button"
                          onClick={toggleSelectAllVersions}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                        >
                          {allGeneratedSelected ? "Clear Selection" : "Select All"}
                        </button>
                      )}

                      {selectedVersionIds.length > 0 && (
                        <button
                          type="button"
                          onClick={openDeleteVersionsModal}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--danger)] px-3 py-1.5 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--surface-2)]"
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                          Delete Selected ({selectedVersionIds.length})
                        </button>
                      )}
                    </div>
                  </div>

                  {versionView === "STRIP" ? (
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {versionAssets.map((asset) => {
                        const active = asset.id === selectedSourceId;
                        const selectedForDelete = selectedVersionIds.includes(asset.id);

                        return (
                          <div key={asset.id} className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => setSelectedSourceId(asset.id)}
                              className={[
                                "group overflow-hidden rounded-xl border p-1.5 transition-colors",
                                selectedForDelete
                                  ? "border-[var(--danger)] bg-[var(--surface-2)]"
                                  : active
                                    ? "border-[var(--foreground)] bg-[var(--surface-2)]"
                                    : "border-[var(--border)] hover:border-[var(--foreground-subtle)]",
                              ].join(" ")}
                            >
                              <div className="h-[72px] w-[110px] overflow-hidden rounded-lg bg-[var(--surface-2)]">
                                <img src={getAssetUrl(asset.filePath)} alt="" className="h-full w-full object-cover" />
                              </div>

                              <div className="flex items-center justify-between px-1 pb-0.5 pt-2">
                                <span className="text-xs">{getVersionLabel(asset)}</span>

                                {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--foreground)]" />}
                              </div>
                            </button>

                            {asset.type === "GENERATED" && (
                              <button
                                type="button"
                                onClick={() => toggleVersionSelection(asset.id)}
                                aria-label={
                                  selectedForDelete
                                    ? `Unselect ${getVersionLabel(asset)} for deletion`
                                    : `Select ${getVersionLabel(asset)} for deletion`
                                }
                                aria-pressed={selectedForDelete}
                                title={selectedForDelete ? "Remove from selection" : "Select for deletion"}
                                className={[
                                  "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition-all",
                                  selectedForDelete
                                    ? "border-[var(--danger)] bg-[var(--danger)] text-black"
                                    : "border-white/20 bg-black/65 text-white/80 hover:border-white/50 hover:bg-black/85",
                                ].join(" ")}
                              >
                                {selectedForDelete && <Check size={13} strokeWidth={2.4} />}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <VersionTreePanel
                      assets={versionAssets}
                      selectedSourceId={selectedSourceId}
                      selectedVersionIds={selectedVersionIds}
                      onSelectSource={setSelectedSourceId}
                      onToggleDeleteSelection={toggleVersionSelection}
                    />
                  )}
                </div>

                {/* Prompt Area */}
                <div className="border-t border-[var(--border)] p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <span className="text-xs uppercase tracking-[0.12em] text-[var(--foreground-subtle)]">
                        Editing from
                      </span>

                      <div className="mt-1 text-[15px] font-medium">
                        {selectedSource ? getVersionLabel(selectedSource) : "—"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {(["STRICT", "BALANCED", "CREATIVE", "NO_RESTRICTION"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPreserveMode(mode)}
                          className={[
                            "rounded-full border px-4 py-2 text-xs",
                            preserveMode === mode
                              ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                              : "border-[var(--border)] text-[var(--foreground-muted)] hover:bg-[var(--surface-2)]",
                          ].join(" ")}
                        >
                          {mode === "NO_RESTRICTION" ? "No Restriction" : mode.charAt(0) + mode.slice(1).toLowerCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--background)] focus-within:border-[var(--foreground-subtle)]">
                    <textarea
                      value={instruction}
                      onChange={(event) => setInstruction(event.target.value)}
                      rows={4}
                      placeholder="Describe what you want to change..."
                      className="w-full resize-none bg-transparent px-5 py-4 text-sm leading-6 outline-none placeholder:text-[var(--foreground-subtle)]"
                    />

                    <input
                      ref={referenceInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(event) => {
                        handleReferenceImages(event.target.files);

                        event.target.value = "";
                      }}
                      className="hidden"
                    />

                    {referenceImages.length > 0 && (
                      <div className="border-t border-[var(--border-soft)] px-4 py-3">
                        <div className="mb-2.5 flex items-center justify-between">
                          <span className="text-[11px] font-medium text-[var(--foreground-muted)]">
                            Reference Images
                          </span>

                          <span className="text-[10px] text-[var(--foreground-subtle)]">
                            {referenceImages.length}/5
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {referenceImages.map((item) => (
                            <div
                              key={item.id}
                              className="group relative h-[72px] w-[72px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]"
                            >
                              <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />

                              <button
                                type="button"
                                onClick={() => removeReferenceImage(item.id)}
                                aria-label={`Remove ${item.file.name}`}
                                title="Remove reference"
                                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/75 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                              >
                                <X size={13} strokeWidth={2} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {referenceError && (
                      <div className="border-t border-[var(--border-soft)] px-4 py-2.5">
                        <p className="text-[11px] text-[var(--danger)]">{referenceError}</p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-soft)] px-4 py-3">
                      {/* Preserve Toggle */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Preserve Everything Else الحالي بالكامل */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={preserveMode === "NO_RESTRICTION" ? false : preserveEverythingElse}
                          onClick={() => setPreserveEverythingElse(!preserveEverythingElse)}
                          disabled={preserveMode === "NO_RESTRICTION"}
                          title={preserveMode === "NO_RESTRICTION" ? "Ignored in No Restriction mode" : undefined}
                          className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <span
                            className={[
                              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150",

                              preserveMode !== "NO_RESTRICTION" && preserveEverythingElse
                                ? "bg-[var(--foreground)]"
                                : "bg-[var(--surface-3)]",
                            ].join(" ")}
                          >
                            <span
                              className={[
                                "block h-4 w-4 rounded-full transition-transform duration-150",

                                preserveMode !== "NO_RESTRICTION" && preserveEverythingElse
                                  ? "translate-x-[18px] bg-[var(--background)]"
                                  : "translate-x-0.5 bg-[var(--foreground-muted)]",
                              ].join(" ")}
                            />
                          </span>

                          <span className="text-xs text-[var(--foreground-muted)]">Preserve Everything Else</span>
                        </button>

                        <button
                          type="button"
                          onClick={openReferencePicker}
                          disabled={referenceImages.length >= 5 || createPrompt.isPending}
                          className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ImagePlus size={15} strokeWidth={1.8} />

                          <span>
                            {referenceImages.length > 0 ? `References (${referenceImages.length})` : "Add References"}
                          </span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleBuildPrompt}
                        disabled={!instruction.trim() || !selectedSourceId || promptIsRunning}
                        className="rounded-xl bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-[var(--background)] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        {promptIsRunning ? "Building Prompt..." : "Build Prompt →"}
                      </button>
                    </div>
                  </div>

                  {createPrompt.isError && (
                    <p className="mt-3 text-sm text-[var(--danger)]">{createPrompt.error.message}</p>
                  )}
                </div>

                <GenerationHistoryPanel
                  projectId={params.projectId}
                  sessionId={params.sessionId}
                  assets={session.assets}
                  selectedSourceId={selectedSourceId}
                  onSelectAsset={setSelectedSourceId}
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteVersionsModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-versions-title"
            className="w-full max-w-[500px] rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--danger)]">
                  <Trash2 size={18} strokeWidth={1.8} />
                </div>

                <div className="min-w-0">
                  <h2 id="delete-versions-title" className="text-[16px] font-medium">
                    Delete {selectedVersionIds.length} {selectedVersionIds.length === 1 ? "version" : "versions"}?
                  </h2>

                  <p className="mt-1.5 text-sm leading-6 text-[var(--foreground-muted)]">
                    Only the versions you selected will be removed. The original and every other version will stay.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeDeleteVersionsModal}
                disabled={deleteVersions.isPending}
                aria-label="Close delete versions dialog"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-[var(--border-soft)] bg-[var(--background)] p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--foreground-subtle)]">Selected versions</p>

              <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                {selectedVersionAssets.map((asset) => (
                  <span
                    key={asset.id}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--foreground-muted)]"
                  >
                    {getVersionLabel(asset)}
                  </span>
                ))}
              </div>

              <p className="mt-3 text-xs leading-5 text-[var(--foreground-subtle)]">
                Versions generated from a selected version are not deleted unless you selected them too.
              </p>
            </div>

            {deleteError && (
              <div className="mt-4 rounded-xl border border-[var(--danger)] px-3.5 py-3 text-sm leading-5 text-[var(--danger)]">
                {deleteError}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteVersionsModal}
                disabled={deleteVersions.isPending}
                className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleDeleteSelectedVersions}
                disabled={deleteVersions.isPending}
                className="inline-flex min-w-[150px] items-center justify-center gap-2 rounded-xl bg-[var(--danger)] px-4 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteVersions.isPending ? (
                  <>
                    <LoaderCircle size={15} strokeWidth={1.8} className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={15} strokeWidth={1.8} />
                    Delete {selectedVersionIds.length === 1 ? "Version" : "Versions"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <PromptModal
        open={promptModalOpen}
        generation={liveGeneration}
        starting={startingPrompt}
        onClose={handlePromptModalClose}
        onGenerationChange={handleGenerationChange}
      />
    </>
  );
}
