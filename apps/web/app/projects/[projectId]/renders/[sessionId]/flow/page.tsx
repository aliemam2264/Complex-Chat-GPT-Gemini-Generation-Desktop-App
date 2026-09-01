"use client";

import { useParams } from "next/navigation";

import { RenderFlowEditor } from "@/components/flow/render-flow-editor";

export default function RenderFlowPage() {
  const params = useParams<{
    projectId: string;
    sessionId: string;
  }>();

  return (
    <main className="h-screen overflow-hidden bg-[#101011] text-white">
      <RenderFlowEditor projectId={params.projectId} sessionId={params.sessionId} />
    </main>
  );
}
