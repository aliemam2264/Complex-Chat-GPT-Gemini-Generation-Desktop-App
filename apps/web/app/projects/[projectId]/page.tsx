"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { apiPost } from "@/lib/api";

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void apiPost<{ projectId: string; sessionId: string }>(
      `/api/projects/${params.projectId}/workspace/ensure`,
      {},
    )
      .then((workspace) => {
        if (!active) return;
        router.replace(`/projects/${workspace.projectId}/renders/${workspace.sessionId}/flow`);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "Could not open project canvas.");
      });

    return () => {
      active = false;
    };
  }, [params.projectId, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex flex-col items-center gap-3 text-center">
        {error ? (
          <>
            <p className="text-sm text-[var(--danger)]">{error}</p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm"
            >
              Back to projects
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="animate-spin" size={22} />
            <p className="text-sm text-[var(--foreground-muted)]">Opening canvas...</p>
          </>
        )}
      </div>
    </main>
  );
}
