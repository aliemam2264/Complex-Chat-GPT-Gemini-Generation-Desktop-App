"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  Play,
  Sparkles,
  Trash2,
  Workflow,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { getAssetUrl } from "@/lib/api";
import type { Asset } from "@/types/project";
import type {
  FlowEdge,
  FlowGeneratorNodeData,
  FlowImageNodeData,
  FlowNode,
  FlowPromptNodeData,
} from "@/types/flow";
import type { PreserveMode } from "@/types/generation";

const CANVAS_WIDTH = 5200;
const CANVAS_HEIGHT = 3200;

const NODE_WIDTH: Record<FlowNode["kind"], number> = {
  IMAGE: 250,
  PROMPT: 310,
  GENERATOR: 350,
};

const NODE_HEIGHT: Record<FlowNode["kind"], number> = {
  IMAGE: 250,
  PROMPT: 250,
  GENERATOR: 410,
};

type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

type PendingConnection = {
  sourceNodeId: string;
  sourcePort: "image" | "text";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type Props = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  assets: Asset[];
  selectedNodeId: string | null;
  runningNodeIds: Set<string>;
  nodeErrors: Record<string, string>;
  onSelectNode: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onChangePrompt: (nodeId: string, text: string) => void;
  onChangeGenerator: (
    nodeId: string,
    patch: Partial<Pick<FlowGeneratorNodeData, "preserveMode" | "preserveEverythingElse" | "historyIndex">>,
  ) => void;
  onConnect: (edge: FlowEdge) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onRunNode: (nodeId: string) => void;
};

function getNodeSize(node: FlowNode) {
  return {
    width: NODE_WIDTH[node.kind],
    height: NODE_HEIGHT[node.kind],
  };
}

function getOutputPoint(node: FlowNode) {
  const size = getNodeSize(node);

  if (node.kind === "GENERATOR") {
    return {
      x: node.x + size.width,
      y: node.y + 128,
    };
  }

  return {
    x: node.x + size.width,
    y: node.y + 108,
  };
}

function getTargetPoint(node: FlowNode, targetPort: FlowEdge["targetPort"]) {
  if (node.kind !== "GENERATOR") {
    return {
      x: node.x,
      y: node.y + 108,
    };
  }

  const offsetByPort = {
    source: 92,
    reference: 132,
    prompt: 172,
  } as const;

  return {
    x: node.x,
    y: node.y + offsetByPort[targetPort],
  };
}

function edgePath(startX: number, startY: number, endX: number, endY: number) {
  const distance = Math.max(90, Math.abs(endX - startX) * 0.45);
  return `M ${startX} ${startY} C ${startX + distance} ${startY}, ${endX - distance} ${endY}, ${endX} ${endY}`;
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, input, textarea, select, [data-flow-port]"));
}

function formatMode(mode: PreserveMode) {
  if (mode === "NO_RESTRICTION") return "No Restriction";
  return mode.charAt(0) + mode.slice(1).toLowerCase();
}

export function FlowCanvas({
  nodes,
  edges,
  assets,
  selectedNodeId,
  runningNodeIds,
  nodeErrors,
  onSelectNode,
  onMoveNode,
  onChangePrompt,
  onChangeGenerator,
  onConnect,
  onDeleteNode,
  onDeleteEdge,
  onRunNode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 120, y: 100, zoom: 0.85 });
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes]);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset] as const)), [assets]);

  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };

      return {
        x: (clientX - rect.left - viewport.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  const fitView = useCallback(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) {
      setViewport({ x: 120, y: 100, zoom: 0.85 });
      return;
    }

    const bounds = nodes.reduce(
      (acc, node) => {
        const size = getNodeSize(node);
        return {
          minX: Math.min(acc.minX, node.x),
          minY: Math.min(acc.minY, node.y),
          maxX: Math.max(acc.maxX, node.x + size.width),
          maxY: Math.max(acc.maxY, node.y + size.height),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );

    const padding = 120;
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const zoom = Math.min(1.15, Math.max(0.35, Math.min((container.clientWidth - padding * 2) / width, (container.clientHeight - padding * 2) / height)));

    setViewport({
      zoom,
      x: (container.clientWidth - width * zoom) / 2 - bounds.minX * zoom,
      y: (container.clientHeight - height * zoom) / 2 - bounds.minY * zoom,
    });
  }, [nodes]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;

      if (selectedEdgeId) {
        event.preventDefault();
        onDeleteEdge(selectedEdgeId);
        setSelectedEdgeId(null);
        return;
      }

      if (selectedNodeId) {
        event.preventDefault();
        onDeleteNode(selectedNodeId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDeleteEdge, onDeleteNode, selectedEdgeId, selectedNodeId]);

  function beginPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const initial = viewport;
    let moved = false;

    onSelectNode(null);
    setSelectedEdgeId(null);

    function move(pointerEvent: PointerEvent) {
      const dx = pointerEvent.clientX - startX;
      const dy = pointerEvent.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setViewport({ ...initial, x: initial.x + dx, y: initial.y + dy });
    }

    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) onSelectNode(null);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    if (event.shiftKey) {
      setViewport((current) => ({ ...current, x: current.x - event.deltaY, y: current.y - event.deltaX }));
      return;
    }

    const rect = container.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const canvasX = (mouseX - viewport.x) / viewport.zoom;
    const canvasY = (mouseY - viewport.y) / viewport.zoom;
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = Math.min(1.8, Math.max(0.35, viewport.zoom * zoomFactor));

    setViewport({
      zoom: nextZoom,
      x: mouseX - canvasX * nextZoom,
      y: mouseY - canvasY * nextZoom,
    });
  }

  function beginNodeDrag(event: React.PointerEvent, node: FlowNode) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = node.x;
    const initialY = node.y;
    onSelectNode(node.id);
    setSelectedEdgeId(null);

    function move(pointerEvent: PointerEvent) {
      const x = initialX + (pointerEvent.clientX - startX) / viewport.zoom;
      const y = initialY + (pointerEvent.clientY - startY) / viewport.zoom;
      onMoveNode(node.id, Math.max(0, x), Math.max(0, y));
    }

    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginConnection(event: React.PointerEvent, node: FlowNode, sourcePort: "image" | "text") {
    event.preventDefault();
    event.stopPropagation();

    const point = getOutputPoint(node);
    const end = clientToCanvas(event.clientX, event.clientY);

    setPendingConnection({
      sourceNodeId: node.id,
      sourcePort,
      startX: point.x,
      startY: point.y,
      endX: end.x,
      endY: end.y,
    });

    function move(pointerEvent: PointerEvent) {
      const next = clientToCanvas(pointerEvent.clientX, pointerEvent.clientY);
      setPendingConnection((current) => (current ? { ...current, endX: next.x, endY: next.y } : current));
    }

    function up() {
      setPendingConnection(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function finishConnection(event: React.PointerEvent, targetNode: FlowNode, targetPort: FlowEdge["targetPort"]) {
    event.preventDefault();
    event.stopPropagation();

    if (!pendingConnection || targetNode.kind !== "GENERATOR" || pendingConnection.sourceNodeId === targetNode.id) return;

    const valid =
      (pendingConnection.sourcePort === "image" && (targetPort === "source" || targetPort === "reference")) ||
      (pendingConnection.sourcePort === "text" && targetPort === "prompt");

    if (!valid) return;

    onConnect({
      id: crypto.randomUUID(),
      sourceNodeId: pendingConnection.sourceNodeId,
      sourcePort: pendingConnection.sourcePort,
      targetNodeId: targetNode.id,
      targetPort,
    });

    setPendingConnection(null);
  }

  function getImageUrl(node: FlowNode) {
    if (node.kind === "IMAGE") {
      const data = node.data as FlowImageNodeData;
      const asset = data.assetId ? assetById.get(data.assetId) : null;
      const filePath = asset?.filePath ?? data.filePath;
      return filePath ? getAssetUrl(filePath) : null;
    }

    if (node.kind === "GENERATOR") {
      const data = node.data as FlowGeneratorNodeData;
      const historyItem = data.history[data.historyIndex] ?? null;
      const assetId = historyItem?.outputAssetId ?? data.outputAssetId;
      const asset = assetId ? assetById.get(assetId) : null;
      return asset ? getAssetUrl(asset.filePath) : null;
    }

    return null;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[#080808]"
      onPointerDown={beginPan}
      onWheel={handleWheel}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-45"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.16) 1px, transparent 1px)",
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      />

      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          {edges.map((edge) => {
            const source = nodeById.get(edge.sourceNodeId);
            const target = nodeById.get(edge.targetNodeId);
            if (!source || !target) return null;

            const start = getOutputPoint(source);
            const end = getTargetPoint(target, edge.targetPort);
            const path = edgePath(start.x, start.y, end.x, end.y);
            const selected = selectedEdgeId === edge.id;

            return (
              <g key={edge.id} className="pointer-events-auto">
                <path d={path} fill="none" stroke="transparent" strokeWidth={16} onClick={(event) => {
                  event.stopPropagation();
                  setSelectedEdgeId(edge.id);
                  onSelectNode(null);
                }} />
                <path
                  d={path}
                  fill="none"
                  stroke={selected ? "rgba(255,255,255,0.92)" : edge.sourcePort === "text" ? "rgba(112,168,255,0.74)" : "rgba(191,136,255,0.74)"}
                  strokeWidth={selected ? 2.4 : 1.8}
                />
              </g>
            );
          })}

          {pendingConnection && (
            <path
              d={edgePath(
                pendingConnection.startX,
                pendingConnection.startY,
                pendingConnection.endX,
                pendingConnection.endY,
              )}
              fill="none"
              stroke={pendingConnection.sourcePort === "text" ? "rgba(112,168,255,0.85)" : "rgba(191,136,255,0.85)"}
              strokeWidth={2}
              strokeDasharray="7 6"
            />
          )}
        </svg>

        {nodes.map((node) => {
          const selected = node.id === selectedNodeId;
          const running = runningNodeIds.has(node.id);
          const imageUrl = getImageUrl(node);
          const error = nodeErrors[node.id];

          if (node.kind === "IMAGE") {
            const data = node.data as FlowImageNodeData;
            return (
              <article
                key={node.id}
                className={[
                  "absolute overflow-hidden rounded-[16px] border bg-[#111] shadow-2xl transition-colors",
                  selected ? "border-white/70" : "border-white/12 hover:border-white/28",
                ].join(" ")}
                style={{ left: node.x, top: node.y, width: NODE_WIDTH.IMAGE, height: NODE_HEIGHT.IMAGE }}
                onPointerDown={(event) => beginNodeDrag(event, node)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(node.id);
                }}
              >
                <div className="flex h-10 items-center justify-between border-b border-white/8 px-3.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <ImageIcon size={14} strokeWidth={1.8} className="text-white/55" />
                    <span className="truncate text-[12px] font-medium text-white/85">{node.title}</span>
                  </div>
                  <span className="rounded-md bg-white/6 px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] text-white/38">
                    {data.roleLabel || "Image"}
                  </span>
                </div>

                <div className="h-[166px] bg-black/45 p-2.5">
                  {imageUrl ? (
                    <img src={imageUrl} alt="" className="h-full w-full rounded-[10px] object-contain" />
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[10px] border border-dashed border-white/10 text-xs text-white/30">
                      No image
                    </div>
                  )}
                </div>

                <div className="flex h-[44px] items-center px-3.5 text-[10px] text-white/40">
                  <span className="truncate">{data.fileName ?? "Select an image in Inspector"}</span>
                </div>

                <button
                  type="button"
                  data-flow-port
                  title="Image output"
                  onPointerDown={(event) => beginConnection(event, node, "image")}
                  className="absolute right-[-7px] top-[101px] h-[14px] w-[14px] rounded-full border-2 border-[#111] bg-[#b98aff] shadow-[0_0_0_1px_rgba(255,255,255,0.25)]"
                />
              </article>
            );
          }

          if (node.kind === "PROMPT") {
            const data = node.data as FlowPromptNodeData;
            return (
              <article
                key={node.id}
                className={[
                  "absolute overflow-hidden rounded-[16px] border bg-[#111] shadow-2xl transition-colors",
                  selected ? "border-white/70" : "border-white/12 hover:border-white/28",
                ].join(" ")}
                style={{ left: node.x, top: node.y, width: NODE_WIDTH.PROMPT, height: NODE_HEIGHT.PROMPT }}
                onPointerDown={(event) => beginNodeDrag(event, node)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(node.id);
                }}
              >
                <div className="flex h-10 items-center gap-2 border-b border-white/8 px-3.5">
                  <MessageSquareText size={14} strokeWidth={1.8} className="text-white/55" />
                  <span className="truncate text-[12px] font-medium text-white/85">{node.title}</span>
                </div>

                <textarea
                  value={data.text}
                  onChange={(event) => onChangePrompt(node.id, event.target.value)}
                  onPointerDown={(event) => event.stopPropagation()}
                  placeholder="Write the edit instruction here..."
                  className="h-[168px] w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-6 text-white/80 outline-none placeholder:text-white/22"
                />

                <div className="flex h-[42px] items-center justify-between border-t border-white/8 px-3.5 text-[10px] text-white/35">
                  <span>Editable text input</span>
                  <span>{data.text.trim().length} chars</span>
                </div>

                <button
                  type="button"
                  data-flow-port
                  title="Text output"
                  onPointerDown={(event) => beginConnection(event, node, "text")}
                  className="absolute right-[-7px] top-[101px] h-[14px] w-[14px] rounded-full border-2 border-[#111] bg-[#70a8ff] shadow-[0_0_0_1px_rgba(255,255,255,0.25)]"
                />
              </article>
            );
          }

          const data = node.data as FlowGeneratorNodeData;
          const historyCount = data.history.length;

          return (
            <article
              key={node.id}
              className={[
                "absolute overflow-hidden rounded-[17px] border bg-[#111] shadow-2xl transition-colors",
                selected ? "border-white/70" : error ? "border-red-500/55" : "border-white/12 hover:border-white/28",
              ].join(" ")}
              style={{ left: node.x, top: node.y, width: NODE_WIDTH.GENERATOR, height: NODE_HEIGHT.GENERATOR }}
              onPointerDown={(event) => beginNodeDrag(event, node)}
              onClick={(event) => {
                event.stopPropagation();
                onSelectNode(node.id);
              }}
            >
              <div className="flex h-11 items-center justify-between border-b border-white/8 px-3.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Sparkles size={14} strokeWidth={1.8} className="text-white/60" />
                  <span className="truncate text-[12px] font-medium text-white/90">{node.title}</span>
                </div>
                <span className="rounded-md bg-white/6 px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] text-white/40">
                  Generator
                </span>
              </div>

              <div className="relative grid h-[142px] grid-cols-[102px_1fr] border-b border-white/8">
                <div className="border-r border-white/8 px-3 py-3">
                  <div className="space-y-4 pt-1 text-[10px] text-white/45">
                    <div className="relative">Source</div>
                    <div className="relative">References</div>
                    <div className="relative">Prompt</div>
                  </div>
                </div>

                <div className="p-3">
                  {imageUrl ? (
                    <img src={imageUrl} alt="" className="h-[116px] w-full rounded-[10px] bg-black/35 object-contain" />
                  ) : (
                    <div className="flex h-[116px] items-center justify-center rounded-[10px] border border-dashed border-white/10 bg-black/20 text-[11px] text-white/28">
                      Result appears here
                    </div>
                  )}
                </div>

                {(["source", "reference", "prompt"] as const).map((port, index) => (
                  <button
                    key={port}
                    type="button"
                    data-flow-port
                    title={`${port} input`}
                    onPointerUp={(event) => finishConnection(event, node, port)}
                    className={[
                      "absolute left-[-7px] h-[14px] w-[14px] rounded-full border-2 border-[#111] shadow-[0_0_0_1px_rgba(255,255,255,0.25)]",
                      port === "prompt" ? "bg-[#70a8ff]" : "bg-[#b98aff]",
                    ].join(" ")}
                    style={{ top: 40 + index * 40 }}
                  />
                ))}
              </div>

              <div className="space-y-3 px-3.5 py-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] uppercase tracking-[0.08em] text-white/30">Restriction</span>
                    <select
                      value={data.preserveMode}
                      onChange={(event) => onChangeGenerator(node.id, { preserveMode: event.target.value as PreserveMode })}
                      onPointerDown={(event) => event.stopPropagation()}
                      className="h-8 w-full rounded-lg border border-white/10 bg-[#0b0b0b] px-2 text-[11px] text-white/70 outline-none"
                    >
                      {(["STRICT", "BALANCED", "CREATIVE", "NO_RESTRICTION"] as PreserveMode[]).map((mode) => (
                        <option key={mode} value={mode}>{formatMode(mode)}</option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-1">
                    <span className="text-[9px] uppercase tracking-[0.08em] text-white/30">Preserve</span>
                    <button
                      type="button"
                      disabled={data.preserveMode === "NO_RESTRICTION"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onChangeGenerator(node.id, { preserveEverythingElse: !data.preserveEverythingElse });
                      }}
                      className="flex h-8 w-full items-center justify-between rounded-lg border border-white/10 bg-[#0b0b0b] px-2.5 text-[11px] text-white/60 disabled:opacity-35"
                    >
                      <span>Everything else</span>
                      <span className={[
                        "h-2 w-2 rounded-full",
                        data.preserveEverythingElse && data.preserveMode !== "NO_RESTRICTION" ? "bg-white" : "bg-white/20",
                      ].join(" ")} />
                    </button>
                  </div>
                </div>

                {error && <div className="line-clamp-2 text-[10px] leading-4 text-red-400">{error}</div>}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-[10px] text-white/35">
                    {historyCount > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onChangeGenerator(node.id, { historyIndex: Math.max(0, data.historyIndex - 1) });
                          }}
                          disabled={data.historyIndex <= 0}
                          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/6 disabled:opacity-20"
                        >
                          <ChevronLeft size={13} />
                        </button>
                        <span>{data.historyIndex + 1}/{historyCount}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onChangeGenerator(node.id, { historyIndex: Math.min(historyCount - 1, data.historyIndex + 1) });
                          }}
                          disabled={data.historyIndex >= historyCount - 1}
                          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/6 disabled:opacity-20"
                        >
                          <ChevronRight size={13} />
                        </button>
                      </>
                    ) : (
                      <span>No runs yet</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRunNode(node.id);
                    }}
                    disabled={running}
                    className="inline-flex h-8 items-center gap-2 rounded-lg bg-white px-3 text-[11px] font-medium text-black disabled:opacity-45"
                  >
                    {running ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                    {running ? "Running" : "Run"}
                  </button>
                </div>
              </div>

              <button
                type="button"
                data-flow-port
                title="Generated image output"
                onPointerDown={(event) => beginConnection(event, node, "image")}
                className="absolute right-[-7px] top-[121px] h-[14px] w-[14px] rounded-full border-2 border-[#111] bg-[#b98aff] shadow-[0_0_0_1px_rgba(255,255,255,0.25)]"
              />
            </article>
          );
        })}
      </div>

      <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-xl border border-white/10 bg-[#111]/95 p-1.5 shadow-xl backdrop-blur-xl">
        <button type="button" title="Zoom out" onClick={() => setViewport((current) => ({ ...current, zoom: Math.max(0.35, current.zoom - 0.1) }))} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/55 hover:bg-white/6 hover:text-white">
          <ZoomOut size={15} />
        </button>
        <span className="min-w-[48px] text-center text-[10px] text-white/40">{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" title="Zoom in" onClick={() => setViewport((current) => ({ ...current, zoom: Math.min(1.8, current.zoom + 0.1) }))} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/55 hover:bg-white/6 hover:text-white">
          <ZoomIn size={15} />
        </button>
        <div className="mx-1 h-5 w-px bg-white/8" />
        <button type="button" title="Fit workflow" onClick={fitView} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/55 hover:bg-white/6 hover:text-white">
          <Maximize2 size={15} />
        </button>
      </div>

      <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-xl border border-white/10 bg-[#111]/90 px-3 py-2 text-[10px] text-white/38 backdrop-blur-xl">
        <Workflow size={13} />
        Drag nodes · Drag ports to connect · Delete removes selection · Wheel zooms
      </div>

      {selectedEdgeId && (
        <button
          type="button"
          onClick={() => {
            onDeleteEdge(selectedEdgeId);
            setSelectedEdgeId(null);
          }}
          className="absolute left-1/2 top-4 inline-flex -translate-x-1/2 items-center gap-2 rounded-lg border border-red-500/25 bg-[#161010] px-3 py-2 text-[11px] text-red-300 shadow-xl"
        >
          <Trash2 size={13} /> Delete connection
        </button>
      )}
    </div>
  );
}
