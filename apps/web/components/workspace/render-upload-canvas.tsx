"use client";

import { type ChangeEvent, type DragEvent, type KeyboardEvent, useCallback, useRef, useState } from "react";

import { ClipboardPaste, ImagePlus, Upload } from "lucide-react";

import { RENDER_IMAGE_ACCEPT, useRenderUpload, validateRenderImage } from "@/hooks/use-render-upload";

import type { ImageSession } from "@/types/project";

type RenderUploadCanvasProps = {
  projectId: string;
  variant?: "empty" | "modal";
  onUploaded?: (session: ImageSession) => void;
};

export function RenderUploadCanvas({ projectId, variant = "empty", onUploaded }: RenderUploadCanvasProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useRenderUpload(projectId);

  const uploadFile = useCallback(
    async (file: File) => {
      const validationError = validateRenderImage(file);

      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);

      try {
        const session = await upload.mutateAsync(file);
        onUploaded?.(session);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
      }
    },
    [onUploaded, upload],
  );

  function openFilePicker() {
    if (upload.isPending) {
      return;
    }

    inputRef.current?.click();
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      void uploadFile(file);
    }

    event.target.value = "";
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    dragCounter.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    dragCounter.current -= 1;

    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    dragCounter.current = 0;
    setIsDragging(false);

    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));

    if (file) {
      void uploadFile(file);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  }

  const compact = variant === "modal";

  return (
    <div className="w-full">
      <input ref={inputRef} type="file" accept={RENDER_IMAGE_ACCEPT} onChange={handleInputChange} className="hidden" />

      <div
        role="button"
        tabIndex={0}
        onClick={openFilePicker}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          "group relative flex w-full items-center justify-center overflow-hidden rounded-[18px] border border-dashed transition-all duration-150",
          compact ? "min-h-[300px]" : "min-h-[330px]",
          isDragging
            ? "border-[#c9b28f] bg-[#c9b28f]/[0.04]"
            : "border-[var(--border)] bg-[var(--surface-1)] hover:border-[var(--foreground-subtle)] hover:bg-[var(--surface-2)]",
        ].join(" ")}
      >
        {upload.isPending ? (
          <div className="px-8 text-center">
            <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--foreground)]" />

            <p className="text-sm font-medium">Adding render...</p>

            <p className="mt-2 text-xs text-[var(--foreground-muted)]">Creating original image session</p>
          </div>
        ) : (
          <div className="max-w-sm px-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--foreground)] transition-colors group-hover:border-[var(--foreground-subtle)]">
              <ImagePlus size={22} strokeWidth={1.7} />
            </div>

            <h2 className="mt-5 text-lg font-medium">{compact ? "Choose a render" : "Add your first render"}</h2>

            <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
              Drop an image here or click to browse your files.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--foreground-subtle)]">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5">
                <Upload size={12} strokeWidth={1.8} />
                Drag & Drop
              </span>

              <span>or</span>

              <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5">
                <ClipboardPaste size={12} strokeWidth={1.8} />
                Ctrl + V
              </span>
            </div>

            <p className="mt-5 text-[11px] text-[var(--foreground-subtle)]">JPG, PNG or WebP · up to 50 MB</p>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
