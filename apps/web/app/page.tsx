"use client";

import { useEffect, useMemo, useState } from "react";

import { AlertTriangle, Check, FolderKanban, ImageIcon, LoaderCircle, Trash2, X } from "lucide-react";

import { ProjectSidebar } from "@/components/projects/project-sidebar";
import { useDeleteProjects, useProjects } from "@/hooks/use-projects";

import type { Project } from "@/types/project";

const EMPTY_PROJECTS: Project[] = [];

export default function DashboardPage() {
  const projectsQuery = useProjects();
  const deleteProjects = useDeleteProjects();

  const projects = projectsQuery.data ?? EMPTY_PROJECTS;

  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const validIds = new Set(projects.map((project) => project.id));

    setSelectedProjectIds((current) => {
      const next = current.filter((id) => validIds.has(id));

      if (
        next.length === current.length &&
        next.every((id, index) => id === current[index])
      ) {
        return current;
      }

      return next;
    });
  }, [projects]);

  const totalRenders = useMemo(
    () =>
      projects.reduce((total, project) => {
        return total + (project._count?.imageSessions ?? 0);
      }, 0),
    [projects],
  );

  const selectedProjects = useMemo(() => {
    const selectedIds = new Set(selectedProjectIds);

    return projects.filter((project) => selectedIds.has(project.id));
  }, [projects, selectedProjectIds]);

  const selectedRenderCount = useMemo(
    () =>
      selectedProjects.reduce((total, project) => {
        return total + (project._count?.imageSessions ?? 0);
      }, 0),
    [selectedProjects],
  );

  const allSelected = projects.length > 0 && selectedProjectIds.length === projects.length;
  const hasSelection = selectedProjectIds.length > 0;
  const latestProject = projects[0];

  function toggleProject(projectId: string) {
    setSelectedProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    );
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedProjectIds([]);
      return;
    }

    setSelectedProjectIds(projects.map((project) => project.id));
  }

  function openDeleteModal() {
    if (!hasSelection) {
      return;
    }

    setDeleteError(null);
    setDeleteModalOpen(true);
  }

  function closeDeleteModal() {
    if (deleteProjects.isPending) {
      return;
    }

    setDeleteError(null);
    setDeleteModalOpen(false);
  }

  async function handleDeleteProjects() {
    if (!hasSelection || deleteProjects.isPending) {
      return;
    }

    setDeleteError(null);

    try {
      await deleteProjects.mutateAsync(selectedProjectIds);

      setSelectedProjectIds([]);
      setDeleteModalOpen(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete the selected projects.");
    }
  }

  if (projectsQuery.isLoading) {
    return (
      <main className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
        <ProjectSidebar />

        <section className="flex min-w-0 flex-1 items-center justify-center">
          <LoaderCircle size={20} strokeWidth={1.8} className="animate-spin text-[var(--foreground-muted)]" />
        </section>
      </main>
    );
  }

  return (
    <>
      <main className="flex h-screen overflow-hidden bg-[#090909] text-[var(--foreground)]">
        <ProjectSidebar />

        <section className="relative min-w-0 flex-1 overflow-y-auto">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden">
            <div className="absolute -top-40 left-[12%] h-[420px] w-[620px] rounded-full bg-[#b6976b]/[0.045] blur-[120px]" />

            <div
              className="absolute inset-0 opacity-[0.035]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
              }}
            />
          </div>

          <div className="relative mx-auto w-full max-w-[1040px] px-10 py-10">
            <header>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9d8b73]">Eskander Plus Studio</p>

              <h1 className="mt-3 text-[30px] font-medium tracking-[-0.035em]">Dashboard</h1>

              <p className="mt-2 text-sm text-[var(--foreground-muted)]">Your architectural AI workspace.</p>
            </header>

            <section className="mt-9 grid grid-cols-2 gap-3">
              <DashboardStat
                icon={FolderKanban}
                label="Projects"
                value={projects.length}
                description="Active workspaces"
              />

              <DashboardStat icon={ImageIcon} label="Renders" value={totalRenders} description="Across all projects" />
            </section>

            {latestProject && (
              <section className="mt-10">
                <SectionTitle title="Latest project" description="Your most recently updated workspace." />

                <div className="mt-4 max-w-[470px] rounded-2xl border border-white/[0.09] bg-[#111111] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035]">
                        <FolderKanban size={16} strokeWidth={1.7} className="text-[#b9aa96]" />
                      </div>

                      <h3 className="text-[15px] font-medium">{latestProject.name}</h3>

                      <p className="mt-1.5 text-xs text-[var(--foreground-muted)]">
                        {latestProject._count?.imageSessions ?? 0}{" "}
                        {(latestProject._count?.imageSessions ?? 0) === 1 ? "render" : "renders"}
                      </p>
                    </div>

                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#a88f6e]" />
                  </div>
                </div>
              </section>
            )}

            <section className="mt-10 pb-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <SectionTitle title="Projects" description="Select one or more projects to manage them." />

                {projects.length > 0 && (
                  <div className="flex items-center gap-2">
                    {hasSelection && (
                      <button
                        type="button"
                        onClick={openDeleteModal}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-3.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/[0.09]"
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                        Delete {selectedProjectIds.length > 1 ? `Selected (${selectedProjectIds.length})` : "Project"}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className={[
                        "inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3.5 text-sm transition-colors",
                        allSelected
                          ? "border-white/[0.18] bg-white/[0.08] text-white"
                          : "border-white/[0.09] text-[var(--foreground-muted)] hover:bg-white/[0.035] hover:text-white",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-4 w-4 items-center justify-center rounded-[5px] border",
                          allSelected ? "border-white bg-white text-black" : "border-white/[0.25] bg-transparent",
                        ].join(" ")}
                      >
                        {allSelected && <Check size={11} strokeWidth={2.4} />}
                      </span>

                      {allSelected ? "Clear All" : "Select All"}
                    </button>
                  </div>
                )}
              </div>

              {projects.length > 0 ? (
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {projects.map((project) => (
                    <ProjectSelectionCard
                      key={project.id}
                      project={project}
                      selected={selectedProjectIds.includes(project.id)}
                      onToggle={() => toggleProject(project.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4 flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-white/[0.09] bg-white/[0.015]">
                  <div className="text-center">
                    <FolderKanban size={20} strokeWidth={1.6} className="mx-auto text-[var(--foreground-muted)]" />

                    <p className="mt-3 text-sm font-medium">Create your first project</p>

                    <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                      Start your first architectural workspace.
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </section>
      </main>

      {deleteModalOpen && (
        <DeleteProjectsModal
          projectCount={selectedProjects.length}
          renderCount={selectedRenderCount}
          projectNames={selectedProjects.map((project) => project.name)}
          deleting={deleteProjects.isPending}
          error={deleteError}
          onClose={closeDeleteModal}
          onConfirm={handleDeleteProjects}
        />
      )}
    </>
  );
}

function ProjectSelectionCard({
  project,
  selected,
  onToggle,
}: {
  project: Project;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={[
        "relative rounded-2xl border bg-[#101010] p-5 transition-colors",
        selected ? "border-white/[0.22] bg-white/[0.035]" : "border-white/[0.08] hover:border-white/[0.13]",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={selected ? `Deselect ${project.name}` : `Select ${project.name}`}
        aria-pressed={selected}
        className={[
          "absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
          selected
            ? "border-white bg-white text-black"
            : "border-white/[0.22] bg-black/20 text-transparent hover:border-white/[0.45]",
        ].join(" ")}
      >
        <Check size={14} strokeWidth={2.3} />
      </button>

      <div className="flex min-w-0 items-start gap-3.5 pr-10">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025]">
          <FolderKanban size={15} strokeWidth={1.7} className="text-[var(--foreground-muted)]" />
        </div>

        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium">{project.name}</p>

          <p className="mt-1 text-xs text-[var(--foreground-muted)]">
            {project._count?.imageSessions ?? 0} {(project._count?.imageSessions ?? 0) === 1 ? "render" : "renders"}
          </p>
        </div>
      </div>
    </div>
  );
}

function DeleteProjectsModal({
  projectCount,
  renderCount,
  projectNames,
  deleting,
  error,
  onClose,
  onConfirm,
}: {
  projectCount: number;
  renderCount: number;
  projectNames: string[];
  deleting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleting, onClose]);

  const allProjects = projectCount > 1;

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-6 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-[520px] overflow-hidden rounded-[20px] border border-white/[0.1] bg-[#111111] shadow-2xl">
        <div className="flex items-start justify-between gap-5 border-b border-white/[0.07] px-6 py-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/[0.07] text-red-400">
              <AlertTriangle size={18} strokeWidth={1.8} />
            </div>

            <div className="min-w-0">
              <h2 className="text-base font-medium">Delete {allProjects ? `${projectCount} projects` : "project"}?</h2>

              <p className="mt-1.5 text-sm leading-6 text-[var(--foreground-muted)]">
                This will permanently delete {allProjects ? "these projects" : "this project"}, all renders, generated
                versions and generation history inside {allProjects ? "them" : "it"}.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            aria-label="Close delete confirmation"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3.5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-[var(--foreground-muted)]">Projects</span>
              <span className="font-medium">{projectCount}</span>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-4 text-sm">
              <span className="text-[var(--foreground-muted)]">Renders inside</span>
              <span className="font-medium">{renderCount}</span>
            </div>
          </div>

          {projectNames.length > 0 && (
            <div className="mt-4 max-h-[120px] overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20 px-4 py-2">
              {projectNames.map((name) => (
                <div
                  key={name}
                  className="border-b border-white/[0.05] py-2.5 text-sm text-[var(--foreground-muted)] last:border-b-0"
                >
                  {name}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-3 rounded-xl border border-red-500/15 bg-red-500/[0.045] px-4 py-3.5">
            <Trash2 size={16} strokeWidth={1.8} className="mt-0.5 shrink-0 text-red-400" />

            <p className="text-xs leading-5 text-red-300/80">This action cannot be undone.</p>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-sm leading-6 text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-white/[0.09] px-4 text-sm font-medium text-[var(--foreground-muted)] transition-colors hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? (
              <LoaderCircle size={15} strokeWidth={1.8} className="animate-spin" />
            ) : (
              <Trash2 size={15} strokeWidth={1.8} />
            )}

            {deleting ? "Deleting..." : allProjects ? "Delete Projects" : "Delete Project"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardStat({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="group rounded-2xl border border-white/[0.09] bg-[#111111] p-5 transition-colors hover:border-white/[0.13]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[var(--foreground-muted)]">
          <Icon size={14} strokeWidth={1.7} />

          <span className="text-xs font-medium uppercase tracking-[0.1em]">{label}</span>
        </div>

        <span className="h-1.5 w-1.5 rounded-full bg-[#a88f6e]" />
      </div>

      <p className="mt-6 text-[30px] font-medium tracking-[-0.04em]">{String(value).padStart(2, "0")}</p>

      <p className="mt-1 text-xs text-[var(--foreground-subtle)]">{description}</p>
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-sm font-medium uppercase tracking-[0.09em] text-[var(--foreground)]">{title}</h2>

      <p className="mt-1 text-xs text-[var(--foreground-muted)]">{description}</p>
    </div>
  );
}
