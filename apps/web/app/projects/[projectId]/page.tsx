"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle, ImagePlus, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { ProjectSidebar } from "@/components/projects/project-sidebar";
import { ImageSessionCard } from "@/components/workspace/image-session-card";
import { RenderUploadCanvas } from "@/components/workspace/render-upload-canvas";

import { useDeleteImageSessions } from "@/hooks/use-delete-image-sessions";
import { useRenderUpload, validateRenderImage } from "@/hooks/use-render-upload";

import { apiGet } from "@/lib/api";

import type { ProjectDetails } from "@/types/project";

export default function ProjectPage() {
  const params = useParams<{
    projectId: string;
  }>();

  const router = useRouter();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addRenderOpen, setAddRenderOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [globalUploadError, setGlobalUploadError] = useState<string | null>(null);

  const globalDragCounter = useRef(0);

  const projectQuery = useQuery({
    queryKey: ["project", params.projectId],

    queryFn: () => apiGet<ProjectDetails>(`/api/projects/${params.projectId}`),
  });

  const deleteSessions = useDeleteImageSessions(params.projectId);
  const globalUpload = useRenderUpload(params.projectId);

  const project = projectQuery.data;

  const allSelected =
    project !== undefined && project.imageSessions.length > 0 && selectedIds.length === project.imageSessions.length;

  const uploadGlobalFile = useCallback(
    async (file: File) => {
      if (globalUpload.isPending) {
        return;
      }

      const validationError = validateRenderImage(file);

      if (validationError) {
        setGlobalUploadError(validationError);
        return;
      }

      setGlobalUploadError(null);

      try {
        await globalUpload.mutateAsync(file);
        setAddRenderOpen(false);
      } catch (error) {
        setGlobalUploadError(error instanceof Error ? error.message : "Could not add render.");
      }
    },
    [globalUpload],
  );

  useEffect(() => {
    function containsFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types ?? []).includes("Files");
    }

    function handleDragEnter(event: DragEvent) {
      if (!containsFiles(event)) {
        return;
      }

      event.preventDefault();

      globalDragCounter.current += 1;
      setIsGlobalDragging(true);
    }

    function handleDragOver(event: DragEvent) {
      if (!containsFiles(event)) {
        return;
      }

      event.preventDefault();

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    }

    function handleDragLeave(event: DragEvent) {
      if (!containsFiles(event)) {
        return;
      }

      event.preventDefault();

      globalDragCounter.current -= 1;

      if (globalDragCounter.current <= 0) {
        globalDragCounter.current = 0;
        setIsGlobalDragging(false);
      }
    }

    function handleDrop(event: DragEvent) {
      if (!containsFiles(event)) {
        return;
      }

      event.preventDefault();

      globalDragCounter.current = 0;
      setIsGlobalDragging(false);

      const image = Array.from(event.dataTransfer?.files ?? []).find((file) => file.type.startsWith("image/"));

      if (image) {
        void uploadGlobalFile(image);
      }
    }

    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;

      if (target?.matches("input, textarea, [contenteditable='true']")) {
        return;
      }

      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));

      const image = imageItem?.getAsFile();

      if (!image) {
        return;
      }

      event.preventDefault();
      void uploadGlobalFile(image);
    }

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("paste", handlePaste);
    };
  }, [uploadGlobalFile]);

  useEffect(() => {
    if (!globalUploadError) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setGlobalUploadError(null);
    }, 4500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [globalUploadError]);

  useEffect(() => {
    if (!addRenderOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAddRenderOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [addRenderOpen]);

  useEffect(() => {
    if (!deleteModalOpen || deleteSessions.isPending) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDeleteModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteModalOpen, deleteSessions.isPending]);

  function toggleSelection(sessionId: string) {
    setSelectedIds((current) =>
      current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId],
    );
  }

  function toggleSelectAll() {
    if (!project) {
      return;
    }

    if (allSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(project.imageSessions.map((session) => session.id));
  }

  function handleDeleteSelected() {
    if (selectedIds.length === 0) {
      return;
    }

    setDeleteModalOpen(true);
  }

  async function confirmDeleteSelected() {
    if (selectedIds.length === 0 || deleteSessions.isPending) {
      return;
    }

    try {
      await deleteSessions.mutateAsync(selectedIds);
      setSelectedIds([]);
      setDeleteModalOpen(false);
    } catch (error) {
      console.error("Failed to delete renders:", error);
    }
  }

  return (
    <main className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <ProjectSidebar />

      <section className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex min-h-[72px] items-center justify-between border-b border-[var(--border)] px-7">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/")}
              title="Back"
              aria-label="Back to projects"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft size={18} strokeWidth={1.8} />
            </button>

            <div>
              <h1 className="text-base font-medium">{project?.name ?? "Loading..."}</h1>

              <p className="mt-0.5 text-xs text-[var(--foreground-subtle)]">Project Workspace</p>
            </div>
          </div>

          {project && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--foreground-muted)]">
                {project.imageSessions.length} {project.imageSessions.length === 1 ? "render" : "renders"}
              </span>

              {project.imageSessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAddRenderOpen(true)}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-3.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-2)]"
                >
                  <Plus size={15} strokeWidth={1.9} />
                  Add Render
                </button>
              )}
            </div>
          )}
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-7">
          {projectQuery.isLoading && (
            <div className="flex min-h-[400px] items-center justify-center text-sm text-[var(--foreground-muted)]">
              Loading project...
            </div>
          )}

          {projectQuery.isError && <div className="text-sm text-[var(--danger)]">Could not load project.</div>}

          {project && (
            <div className="mx-auto max-w-[1400px]">
              {globalUploadError && (
                <div className="mb-5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]">
                  {globalUploadError}
                </div>
              )}

              {project.imageSessions.length === 0 ? (
                <RenderUploadCanvas projectId={project.id} />
              ) : (
                <>
                  {/* Renders Header / Bulk Actions */}
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-medium tracking-[-0.02em]">Renders</h2>

                      <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                        Select a render to start refining it.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)]"
                      >
                        {allSelected ? "Deselect All" : "Select All"}
                      </button>

                      {selectedIds.length > 0 && (
                        <button
                          type="button"
                          disabled={deleteSessions.isPending}
                          onClick={handleDeleteSelected}
                          className="rounded-lg border border-[var(--danger)]/40 px-3.5 py-2 text-xs text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 disabled:opacity-40"
                        >
                          {deleteSessions.isPending ? "Deleting..." : `Delete (${selectedIds.length})`}
                        </button>
                      )}
                    </div>
                  </div>

                  {deleteSessions.isError && (
                    <div className="mb-5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]">
                      {deleteSessions.error instanceof Error
                        ? deleteSessions.error.message
                        : "Could not delete selected renders."}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3">
                    {project.imageSessions.map((session) => (
                      <ImageSessionCard
                        key={session.id}
                        session={session}
                        selected={selectedIds.includes(session.id)}
                        onSelect={toggleSelection}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Delete Renders Modal */}
      {deleteModalOpen && selectedIds.length > 0 && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-black/75 p-6 backdrop-blur-[3px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleteSessions.isPending) {
              setDeleteModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-[500px] overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl">
            <div className="flex items-start justify-between gap-5 border-b border-[var(--border)] px-6 py-5">
              <div className="flex min-w-0 items-start gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 text-[var(--danger)]">
                  <AlertTriangle size={18} strokeWidth={1.8} />
                </div>

                <div className="min-w-0">
                  <h2 className="text-base font-medium">
                    {selectedIds.length === 1 ? "Delete render?" : `Delete ${selectedIds.length} renders?`}
                  </h2>

                  <p className="mt-1.5 text-sm leading-6 text-[var(--foreground-muted)]">
                    {selectedIds.length === 1
                      ? "This render and all of its generated versions will be permanently removed."
                      : "These renders and all of their generated versions will be permanently removed."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleteSessions.isPending}
                aria-label="Close delete confirmation"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="rounded-xl border border-[var(--danger)]/15 bg-[var(--danger)]/[0.04] px-4 py-3">
                <p className="text-sm font-medium text-[var(--foreground)]">This action cannot be undone.</p>
                <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">
                  The original render, its versions, and related generation history will be deleted.
                </p>
              </div>

              {deleteSessions.isError && (
                <div className="mt-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm leading-6 text-[var(--danger)]">
                  {deleteSessions.error instanceof Error
                    ? deleteSessions.error.message
                    : "Could not delete selected renders."}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-1)] px-6 py-4">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleteSessions.isPending}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmDeleteSelected}
                disabled={deleteSessions.isPending}
                className="inline-flex h-10 min-w-[132px] items-center justify-center gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleteSessions.isPending ? (
                  <>
                    <LoaderCircle size={15} strokeWidth={1.8} className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={15} strokeWidth={1.8} />
                    {selectedIds.length === 1 ? "Delete Render" : "Delete Renders"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Render Modal */}
      {project && addRenderOpen && (
        <div
          className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-6 backdrop-blur-[3px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setAddRenderOpen(false);
            }
          }}
        >
          <div className="w-full max-w-[680px] overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
              <div>
                <div className="flex items-center gap-2.5">
                  <ImagePlus size={18} strokeWidth={1.8} className="text-[#c9b28f]" />
                  <h2 className="text-base font-medium">Add a render</h2>
                </div>

                <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
                  Add another original render to this project.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setAddRenderOpen(false)}
                aria-label="Close add render modal"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div className="p-6">
              <RenderUploadCanvas projectId={project.id} variant="modal" onUploaded={() => setAddRenderOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Global Drag & Drop Overlay */}
      {project && isGlobalDragging && (
        <div className="pointer-events-none fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-8 backdrop-blur-[2px]">
          <div className="flex min-h-[260px] w-full max-w-[620px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#c9b28f]/70 bg-[#111111]/95 px-8 text-center shadow-2xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9b28f]/20 bg-[#c9b28f]/10 text-[#c9b28f]">
              <ImagePlus size={24} strokeWidth={1.7} />
            </div>

            <h2 className="mt-5 text-lg font-medium">Drop to add a new render</h2>

            <p className="mt-2 text-sm text-[var(--foreground-muted)]">
              Release the image anywhere on this page to upload it to {project.name}.
            </p>
          </div>
        </div>
      )}

      {/* Global Paste / Drop Upload Feedback */}
      {globalUpload.isPending && !addRenderOpen && (
        <div className="fixed bottom-5 left-1/2 z-[170] flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#111111]/95 px-4 py-3 text-sm shadow-2xl backdrop-blur-xl">
          <LoaderCircle size={15} strokeWidth={1.8} className="animate-spin text-[#c9b28f]" />
          Adding render...
        </div>
      )}
    </main>
  );
}
