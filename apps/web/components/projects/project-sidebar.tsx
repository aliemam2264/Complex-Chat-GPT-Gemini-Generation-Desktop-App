"use client";

import Link from "next/link";
import { useState } from "react";

import { useProjects } from "@/hooks/use-projects";

import { NewProjectModal } from "./new-project-modal";

import { Settings } from "lucide-react";

export function ProjectSidebar() {
  const [modalOpen, setModalOpen] = useState(false);

  const projectsQuery = useProjects();

  return (
    <>
      <aside className="flex h-screen w-[260px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0d0d0d]">
        <div className="w-full border-b border-white/[0.08] px-6 py-7">
          <Link href="/" className="inline-flex flex-col" aria-label="Go to dashboard">
            <span className="text-[18px] font-semibold tracking-[-0.04em]">Eskander+</span>

            <span className="mt-2 text-[9px] font-medium tracking-[0.28em] text-[var(--foreground-muted)]">STUDIO</span>
          </Link>
        </div>
        {/* add new Projects */}
        <div className="p-4">
          <button
            onClick={() => setModalOpen(true)}
            className="w-full rounded-xl bg-[var(--foreground)] px-4 py-3 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90"
          >
            + New Project
          </button>
        </div>
        {/* Projects */}
        <div className="px-5 pb-2 pt-3 text-[10px] uppercase tracking-[0.2em] text-[var(--foreground-subtle)]">
          Projects
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {projectsQuery.isLoading && (
            <div className="px-3 py-4 text-sm text-[var(--foreground-muted)]">Loading projects...</div>
          )}

          {projectsQuery.isError && (
            <div className="px-3 py-4 text-sm text-[var(--danger)]">Could not load projects.</div>
          )}

          {projectsQuery.data?.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="mb-1 block rounded-xl px-3 py-3 transition-colors hover:bg-[var(--surface-2)]"
            >
              <div className="truncate text-sm font-medium">{project.name}</div>

              <div className="mt-1 text-xs text-[var(--foreground-subtle)]">
                {project._count?.imageSessions ?? 0} views
              </div>
            </Link>
          ))}

          {projectsQuery.data?.length === 0 && (
            <div className="px-3 py-5 text-sm leading-6 text-[var(--foreground-subtle)]">No projects yet.</div>
          )}
        </div>

        {/* Settings */}
        <div className="mt-auto border-t border-[var(--border)] p-3">
          <Link
            href="/settings"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-md text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            <Settings size={15} strokeWidth={1.8} />
            <span>Settings</span>
          </Link>
        </div>
      </aside>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
