"use client";

import { FormEvent, useState } from "react";

import { useCreateProject } from "@/hooks/use-projects";

type NewProjectModalProps = {
  open: boolean;
  onClose: () => void;
};

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const [name, setName] = useState("");

  const [description, setDescription] = useState("");

  const createProject = useCreateProject();

  if (!open) {
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!name.trim()) {
      return;
    }

    await createProject.mutateAsync({
      name: name.trim(),

      description: description.trim() || undefined,
    });

    setName("");
    setDescription("");

    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-md rounded-[18px] border border-[var(--border)] bg-[var(--surface-1)] p-6 shadow-2xl">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--foreground-subtle)]">New Project</p>

          <h2 className="mt-2 text-2xl font-medium tracking-tight">Create project</h2>

          <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
            Start a new architectural visualization workspace.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[var(--foreground-muted)]">Project name</label>

            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Type the project name"
              autoFocus
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 outline-none transition-colors placeholder:text-[var(--foreground-subtle)] focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[var(--foreground-muted)]">Description</label>

            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional project notes..."
              rows={4}
              className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 outline-none transition-colors placeholder:text-[var(--foreground-subtle)] focus:border-[var(--accent)]"
            />
          </div>

          {createProject.isError && <p className="text-sm text-[var(--danger)]">{createProject.error.message}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)]"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={!name.trim() || createProject.isPending}
              className="rounded-xl bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-[var(--background)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {createProject.isPending ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
