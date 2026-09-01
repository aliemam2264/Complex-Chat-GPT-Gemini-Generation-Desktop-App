"use client";

import { Image as ImageIcon, Play, RotateCcw, Trash2, Workflow } from "lucide-react";

import { getAssetUrl } from "@/lib/api";
import type { FlowEdge, FlowGeneratorNodeData, FlowImageNodeData, FlowNode, FlowPromptNodeData } from "@/types/flow";
import type { Asset } from "@/types/project";
import type { PreserveMode } from "@/types/generation";

type Props = {
  node: FlowNode | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  assets: Asset[];
  running: boolean;
  error: string | null;
  onRename: (nodeId: string, title: string) => void;
  onChangeImageAsset: (nodeId: string, assetId: string) => void;
  onChangePrompt: (nodeId: string, text: string) => void;
  onChangeGenerator: (nodeId: string, patch: Partial<FlowGeneratorNodeData>) => void;
  onRunNode: (nodeId: string) => void;
  onRunDownstream: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
};

function formatMode(mode: PreserveMode) {
  if (mode === "NO_RESTRICTION") return "No Restriction";
  return mode.charAt(0) + mode.slice(1).toLowerCase();
}

export function FlowInspector({
  node,
  nodes,
  edges,
  assets,
  running,
  error,
  onRename,
  onChangeImageAsset,
  onChangePrompt,
  onChangeGenerator,
  onRunNode,
  onRunDownstream,
  onDeleteNode,
}: Props) {
  if (!node) {
    return (
      <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-white/8 bg-[#0d0d0d]">
        <div className="border-b border-white/8 px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.12em] text-white/28">Inspector</p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <Workflow size={28} strokeWidth={1.4} className="text-white/20" />
          <p className="mt-4 text-sm text-white/60">Select a node</p>
          <p className="mt-2 text-xs leading-5 text-white/30">
            Every image, prompt, generator setting and output can be edited from here.
          </p>
        </div>
      </aside>
    );
  }

  const incoming = edges.filter((edge) => edge.targetNodeId === node.id);
  const sourceNames = incoming
    .filter((edge) => edge.targetPort === "source")
    .map((edge) => nodes.find((item) => item.id === edge.sourceNodeId)?.title)
    .filter(Boolean);
  const referenceNames = incoming
    .filter((edge) => edge.targetPort === "reference")
    .map((edge) => nodes.find((item) => item.id === edge.sourceNodeId)?.title)
    .filter(Boolean);
  const promptNames = incoming
    .filter((edge) => edge.targetPort === "prompt")
    .map((edge) => nodes.find((item) => item.id === edge.sourceNodeId)?.title)
    .filter(Boolean);

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-white/8 bg-[#0d0d0d]">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-white/28">Inspector</p>
            <p className="mt-1 text-xs text-white/50">{node.kind === "GENERATOR" ? "Image Generator" : node.kind === "PROMPT" ? "Text / Prompt" : "Image Input"}</p>
          </div>
          <button
            type="button"
            onClick={() => onDeleteNode(node.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/35 transition-colors hover:bg-red-500/10 hover:text-red-300"
            title="Delete node"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.1em] text-white/28">Node name</span>
          <input
            value={node.title}
            onChange={(event) => onRename(node.id, event.target.value)}
            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-[#090909] px-3 text-sm text-white/75 outline-none focus:border-white/30"
          />
        </label>

        {node.kind === "IMAGE" && (() => {
          const data = node.data as FlowImageNodeData;
          const selectedAsset = data.assetId ? assets.find((asset) => asset.id === data.assetId) : null;
          const previewPath = selectedAsset?.filePath ?? data.filePath;
          return (
            <div className="mt-5 space-y-5">
              <div>
                <span className="text-[10px] uppercase tracking-[0.1em] text-white/28">Image</span>
                <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/30 p-2">
                  {previewPath ? (
                    <img src={getAssetUrl(previewPath)} alt="" className="h-[150px] w-full rounded-lg object-contain" />
                  ) : (
                    <div className="flex h-[150px] items-center justify-center text-xs text-white/25">No image selected</div>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.1em] text-white/28">Replace image</span>
                <select
                  value={data.assetId ?? ""}
                  onChange={(event) => onChangeImageAsset(node.id, event.target.value)}
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-[#090909] px-3 text-xs text-white/65 outline-none"
                >
                  <option value="">Keep current file</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.type === "ORIGINAL" ? "Original" : asset.type === "FLOW_INPUT" ? `Flow · ${asset.fileName}` : asset.fileName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3 text-[11px] leading-5 text-white/38">
                <div className="flex items-center gap-2 text-white/55"><ImageIcon size={13} /> Image output</div>
                <p className="mt-1">Connect this node to Source or References on any Generator.</p>
              </div>
            </div>
          );
        })()}

        {node.kind === "PROMPT" && (() => {
          const data = node.data as FlowPromptNodeData;
          return (
            <div className="mt-5">
              <span className="text-[10px] uppercase tracking-[0.1em] text-white/28">Prompt</span>
              <textarea
                value={data.text}
                onChange={(event) => onChangePrompt(node.id, event.target.value)}
                placeholder="Describe the change..."
                className="mt-2 min-h-[260px] w-full resize-y rounded-xl border border-white/10 bg-[#090909] p-3 text-[13px] leading-6 text-white/75 outline-none focus:border-white/30"
              />
              <p className="mt-2 text-[10px] text-white/28">This text stays live. Change it and rerun the connected generator.</p>
            </div>
          );
        })()}

        {node.kind === "GENERATOR" && (() => {
          const data = node.data as FlowGeneratorNodeData;
          const historyItem = data.history[data.historyIndex] ?? null;
          const outputAssetId = historyItem?.outputAssetId ?? data.outputAssetId;
          const outputAsset = outputAssetId ? assets.find((asset) => asset.id === outputAssetId) : null;

          return (
            <div className="mt-5 space-y-5">
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-3 text-[11px]">
                <div><span className="text-white/30">Source</span><p className="mt-1 truncate text-white/60">{sourceNames.join(", ") || "Not connected"}</p></div>
                <div><span className="text-white/30">Prompt</span><p className="mt-1 truncate text-white/60">{promptNames.join(", ") || "Not connected"}</p></div>
                <div><span className="text-white/30">References</span><p className="mt-1 truncate text-white/60">{referenceNames.join(", ") || "None"}</p></div>
              </div>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.1em] text-white/28">Restriction preset</span>
                <select
                  value={data.preserveMode}
                  onChange={(event) => onChangeGenerator(node.id, { preserveMode: event.target.value as PreserveMode })}
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-[#090909] px-3 text-xs text-white/65 outline-none"
                >
                  {(["STRICT", "BALANCED", "CREATIVE", "NO_RESTRICTION"] as PreserveMode[]).map((mode) => (
                    <option key={mode} value={mode}>{formatMode(mode)}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                disabled={data.preserveMode === "NO_RESTRICTION"}
                onClick={() => onChangeGenerator(node.id, { preserveEverythingElse: !data.preserveEverythingElse })}
                className="flex h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-[#090909] px-3 text-xs text-white/60 disabled:opacity-35"
              >
                <span>Preserve everything else</span>
                <span className={[
                  "h-2.5 w-2.5 rounded-full",
                  data.preserveEverythingElse && data.preserveMode !== "NO_RESTRICTION" ? "bg-white" : "bg-white/20",
                ].join(" ")} />
              </button>

              <div>
                <span className="text-[10px] uppercase tracking-[0.1em] text-white/28">Current output</span>
                <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/30 p-2">
                  {outputAsset ? (
                    <img src={getAssetUrl(outputAsset.filePath)} alt="" className="h-[150px] w-full rounded-lg object-contain" />
                  ) : (
                    <div className="flex h-[150px] items-center justify-center text-xs text-white/25">Run this node to generate</div>
                  )}
                </div>
              </div>

              {historyItem && (
                <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
                  <span className="text-[10px] uppercase tracking-[0.1em] text-white/28">Prompt used for this output</span>
                  <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-white/55">{historyItem.prompt}</p>
                  <p className="mt-2 text-[9px] text-white/22">Generation {historyItem.generationId.slice(-6)} · {new Date(historyItem.createdAt).toLocaleString()}</p>
                </div>
              )}

              {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-300">{error}</div>}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => onRunNode(node.id)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white text-xs font-medium text-black disabled:opacity-40"
                >
                  <Play size={13} fill="currentColor" /> Run Node
                </button>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => onRunDownstream(node.id)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/12 text-xs text-white/65 hover:bg-white/5 disabled:opacity-40"
                >
                  <RotateCcw size={13} /> Run Downstream
                </button>
              </div>

              <p className="text-[10px] leading-5 text-white/28">
                Reruns stay in this node&apos;s history, so you can compare outputs without losing the previous one.
              </p>
            </div>
          );
        })()}
      </div>
    </aside>
  );
}
