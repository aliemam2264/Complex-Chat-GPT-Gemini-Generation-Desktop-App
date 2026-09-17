"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function LegacyRenderWorkspaceRedirect() {
  const router = useRouter();
  const params = useParams<{ projectId: string; sessionId: string }>();

  useEffect(() => {
    router.replace(`/projects/${params.projectId}/renders/${params.sessionId}/flow`);
  }, [params.projectId, params.sessionId, router]);

  return (
    <main className="flex h-screen items-center justify-center bg-[#101011] text-sm text-white/55">
      Opening canvas…
    </main>
  );
}
