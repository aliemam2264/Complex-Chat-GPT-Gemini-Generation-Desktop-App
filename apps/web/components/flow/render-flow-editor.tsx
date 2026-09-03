"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  CirclePlay,
  Copy,
  Download,
  FileImage,
  GripVertical,
  Hand,
  ImagePlus,
  Link2,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Redo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import {
  useCancelGeneration,
  useCreateFlowImageGeneration,
  useRefineFlowPrompt,
  useRetryGeneration,
} from "@/hooks/use-prompt-generation";
import { useChatGPTStatus, useGeminiStatus } from "@/hooks/use-provider-settings";
import { apiGet, apiUpload, getAssetUrl } from "@/lib/api";
import { useGenerationActivityStore } from "@/stores/use-generation-activity-store";

import type { PreserveMode } from "@/types/generation";
import type { Asset, ImageSession } from "@/types/project";

type FlowReferenceImage = {
  id: string;
  generationRunId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  sortOrder: number;
  createdAt: string;
};

type FlowGeneration = {
  id: string;
  projectId: string;
  imageSessionId: string;
  sourceAssetId: string;
  outputAssetId: string | null;
  userInstruction: string;
  refinedPrompt: string | null;
  preserveMode: PreserveMode;
  preserveEverythingElse: boolean;
  status: string;
  progressStage: string | null;
  progressMessage: string | null;
  errorMessage: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  sourceAsset: Asset;
  outputAsset: Asset | null;
  referenceImages: FlowReferenceImage[];
};

type FlowData = {
  session: ImageSession;
  generations: FlowGeneration[];
};

type NodeKind = "TEXT" | "ASSISTANT" | "IMAGE_GENERATOR" | "IMAGE";
type ToolMode = "SELECT" | "PAN";
type OutputType = "TEXT" | "IMAGE";
type GeneratorInput = "PROMPT" | "SOURCE" | "REFERENCE";

type TextNodeData = {
  title: string;
  text: string;
  generationId?: string;
};

type AssistantState = "IDLE" | "RUNNING" | "READY" | "ERROR";

type AssistantNodeData = {
  title: string;
  textNodeId: string | null;
  outputText: string;
  state: AssistantState;
  errorMessage: string | null;
  includeReferences: boolean;
  generationId?: string;
};

type GeneratorNodeData = {
  title: string;
  promptNodeId: string | null;
  sourceNodeId: string | null;
  referenceNodeIds: string[];
  preserveMode: PreserveMode;
  preserveEverythingElse: boolean;
  generationId?: string;
  status: string;
  progressMessage: string | null;
  errorMessage: string | null;
  outputAsset: Asset | null;
};

type ImageNodeData = {
  title: string;
  fileName: string;
  mimeType: string;
  previewUrl: string;
  asset?: Asset;
  localFile?: File;
  remoteFilePath?: string;
  referenceImageId?: string;
  generationId?: string;
  role: "SOURCE" | "REFERENCE" | "IMAGE";
};

type CanvasNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  data: TextNodeData | AssistantNodeData | GeneratorNodeData | ImageNodeData;
};

type Camera = {
  x: number;
  y: number;
  zoom: number;
};

type NodeDrag = {
  nodeIds: string[];
  startClientX: number;
  startClientY: number;
  startPositions: Record<string, { x: number; y: number }>;
} | null;

type SelectionDrag = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
  initialSelection: string[];
} | null;

type PanDrag = {
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
} | null;

type PendingConnection = {
  fromNodeId: string;
  outputType: OutputType;
} | null;

type AddMenuState = {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  pending: PendingConnection;
} | null;

type FlowHistorySnapshot = {
  nodes: CanvasNode[];
  hiddenGenerationIds: string[];
  hiddenNodeIds: string[];
};

type CanvasEdge = {
  id: string;
  fromId: string;
  toId: string;
  target: "ASSISTANT_TEXT" | "GENERATOR_PROMPT" | "GENERATOR_SOURCE" | "GENERATOR_REFERENCE";
  referenceIndex?: number;
};

type RenderFlowEditorProps = {
  projectId: string;
  sessionId: string;
};

const ACTIVE_STATUSES = new Set(["PENDING", "PROMPTING", "PROMPT_READY", "GENERATING", "DOWNLOADING"]);
const WORLD_WIDTH = 5200;
const WORLD_HEIGHT = 3600;
const MIN_ZOOM = 0.38;
const MAX_ZOOM = 1.55;

const TEXT_SIZE = { width: 430, height: 270 };
const ASSISTANT_SIZE = { width: 380, height: 365 };
const GENERATOR_SIZE = { width: 455, height: 410 };
const AUTO_LAYOUT_MARGIN = 44;
const AUTO_LAYOUT_ROW_GAP = 110;
const AUTO_LAYOUT_COLUMN_GAP = 120;
const IMAGE_SIZE = { width: 245, height: 205 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function curvePath(fromX: number, fromY: number, toX: number, toY: number) {
  const distance = Math.max(90, Math.abs(toX - fromX) * 0.48);
  return `M ${fromX} ${fromY} C ${fromX + distance} ${fromY}, ${toX - distance} ${toY}, ${toX} ${toY}`;
}

function getNodeOutputPoint(node: CanvasNode) {
  if (node.kind === "IMAGE") {
    return { x: node.x + node.width, y: node.y + 92 };
  }

  return { x: node.x + node.width, y: node.y + 70 };
}

function getGeneratorInputPoint(node: CanvasNode, input: GeneratorInput, referenceIndex = 0) {
  if (input === "PROMPT") return { x: node.x, y: node.y + 72 };
  if (input === "SOURCE") return { x: node.x, y: node.y + 126 };
  void referenceIndex;
  return { x: node.x, y: node.y + 176 };
}

function getAssistantInputPoint(node: CanvasNode) {
  return { x: node.x, y: node.y + 72 };
}

function imageTitle(index: number, role: ImageNodeData["role"]) {
  if (role === "SOURCE") return `Source Image #${index}`;
  if (role === "REFERENCE") return `Reference #${index}`;
  return `Image #${index}`;
}

function makeImageNode(input: {
  id: string;
  x: number;
  y: number;
  title: string;
  asset?: Asset;
  reference?: FlowReferenceImage;
  localFile?: File;
  role: ImageNodeData["role"];
  generationId?: string;
}): CanvasNode {
  const previewUrl = input.localFile
    ? URL.createObjectURL(input.localFile)
    : input.asset
      ? getAssetUrl(input.asset.filePath)
      : input.reference
        ? getAssetUrl(input.reference.filePath)
        : "";

  return {
    id: input.id,
    kind: "IMAGE",
    x: input.x,
    y: input.y,
    width: IMAGE_SIZE.width,
    height: IMAGE_SIZE.height,
    data: {
      title: input.title,
      fileName: input.localFile?.name ?? input.asset?.fileName ?? input.reference?.fileName ?? "Image",
      mimeType: input.localFile?.type ?? input.asset?.mimeType ?? input.reference?.mimeType ?? "image/png",
      previewUrl,
      asset: input.asset,
      localFile: input.localFile,
      remoteFilePath: input.reference?.filePath,
      referenceImageId: input.reference?.id,
      generationId: input.generationId,
      role: input.role,
    } satisfies ImageNodeData,
  };
}

function makeGenerationNodes(generation: FlowGeneration, index: number): CanvasNode[] {
  const rowY = 190 + index * 610;
  const sourceId = `flow-source-${generation.id}`;
  const textId = `flow-text-${generation.id}`;
  const assistantId = `flow-assistant-${generation.id}`;
  const generatorId = `flow-generator-${generation.id}`;

  const nodes: CanvasNode[] = [
    makeImageNode({
      id: sourceId,
      x: 330,
      y: rowY + 330,
      title: imageTitle(index + 1, "SOURCE"),
      asset: generation.sourceAsset,
      role: "SOURCE",
      generationId: generation.id,
    }),
    {
      id: textId,
      kind: "TEXT",
      x: 330,
      y: rowY,
      width: TEXT_SIZE.width,
      height: TEXT_SIZE.height,
      data: {
        title: `Text #${index + 1}`,
        text: generation.userInstruction,
        generationId: generation.id,
      } satisfies TextNodeData,
    },
    {
      id: assistantId,
      kind: "ASSISTANT",
      x: 840,
      y: rowY - 10,
      width: ASSISTANT_SIZE.width,
      height: ASSISTANT_SIZE.height,
      data: {
        title: `Assistant #${index + 1}`,
        textNodeId: textId,
        outputText: generation.refinedPrompt ?? "",
        state: generation.refinedPrompt ? "READY" : generation.status === "FAILED" ? "ERROR" : "IDLE",
        errorMessage: generation.refinedPrompt ? null : generation.errorMessage,
        includeReferences: false,
        generationId: generation.id,
      } satisfies AssistantNodeData,
    },
    {
      id: generatorId,
      kind: "IMAGE_GENERATOR",
      x: 1305,
      y: rowY - 20,
      width: GENERATOR_SIZE.width,
      height: GENERATOR_SIZE.height,
      data: {
        title: `Image Generator #${index + 1}`,
        promptNodeId: assistantId,
        sourceNodeId: sourceId,
        referenceNodeIds: generation.referenceImages.map((reference) => `flow-reference-${reference.id}`),
        preserveMode: generation.preserveMode,
        preserveEverythingElse: generation.preserveEverythingElse,
        generationId: generation.id,
        status: generation.status,
        progressMessage: generation.progressMessage,
        errorMessage: generation.errorMessage,
        outputAsset: generation.outputAsset,
      } satisfies GeneratorNodeData,
    },
  ];

  generation.referenceImages.forEach((reference, referenceIndex) => {
    nodes.push(
      makeImageNode({
        id: `flow-reference-${reference.id}`,
        x: 35 + referenceIndex * 55,
        y: rowY + 315 + referenceIndex * 52,
        title: `Reference #${referenceIndex + 1}`,
        reference,
        role: "REFERENCE",
        generationId: generation.id,
      }),
    );
  });

  return nodes;
}

function getNodeGenerationId(node: CanvasNode) {
  if (node.kind === "TEXT") return (node.data as TextNodeData).generationId;
  if (node.kind === "ASSISTANT") return (node.data as AssistantNodeData).generationId;
  if (node.kind === "IMAGE_GENERATOR") return (node.data as GeneratorNodeData).generationId;
  return (node.data as ImageNodeData).generationId;
}

function serializeDraftNode(node: CanvasNode): CanvasNode | null {
  if (getNodeGenerationId(node)) return null;

  if (node.kind !== "IMAGE") return node;

  const image = node.data as ImageNodeData;
  if (!image.asset && !image.remoteFilePath) return null;

  return {
    ...node,
    data: {
      ...image,
      localFile: undefined,
      previewUrl: image.asset
        ? getAssetUrl(image.asset.filePath)
        : image.remoteFilePath
          ? getAssetUrl(image.remoteFilePath)
          : "",
    } satisfies ImageNodeData,
  };
}

function rehydrateDraftNode(node: CanvasNode): CanvasNode {
  if (node.kind !== "IMAGE") return node;

  const image = node.data as ImageNodeData;
  return {
    ...node,
    data: {
      ...image,
      localFile: undefined,
      previewUrl: image.asset
        ? getAssetUrl(image.asset.filePath)
        : image.remoteFilePath
          ? getAssetUrl(image.remoteFilePath)
          : image.previewUrl,
    } satisfies ImageNodeData,
  };
}

function getReferenceIdentity(image: ImageNodeData) {
  if (image.role !== "REFERENCE") return null;

  const fileName = image.fileName.trim().toLowerCase();
  const mimeType = image.mimeType.trim().toLowerCase();
  if (!fileName) return null;

  return `${fileName}::${mimeType}`;
}

function dedupeFlowImageNodes(nodes: CanvasNode[]) {
  const sourceNodeByAssetId = new Map<string, string>();
  const referenceNodeByIdentity = new Map<string, string>();
  const nodeIdRemap = new Map<string, string>();
  const kept: CanvasNode[] = [];

  for (const node of nodes) {
    if (node.kind !== "IMAGE") {
      kept.push(node);
      continue;
    }

    const image = node.data as ImageNodeData;
    const sourceAssetId = image.role === "SOURCE" ? image.asset?.id : undefined;
    const referenceIdentity = getReferenceIdentity(image);

    if (sourceAssetId) {
      const existingNodeId = sourceNodeByAssetId.get(sourceAssetId);
      if (existingNodeId) {
        nodeIdRemap.set(node.id, existingNodeId);
        continue;
      }
      sourceNodeByAssetId.set(sourceAssetId, node.id);
    }

    if (referenceIdentity) {
      const existingNodeId = referenceNodeByIdentity.get(referenceIdentity);
      if (existingNodeId) {
        nodeIdRemap.set(node.id, existingNodeId);
        continue;
      }
      referenceNodeByIdentity.set(referenceIdentity, node.id);
    }

    kept.push(node);
  }

  if (nodeIdRemap.size === 0) return kept;

  return kept.map((node) => {
    if (node.kind === "ASSISTANT") {
      const data = node.data as AssistantNodeData;
      const textNodeId = data.textNodeId ? nodeIdRemap.get(data.textNodeId) ?? data.textNodeId : null;
      return textNodeId === data.textNodeId ? node : { ...node, data: { ...data, textNodeId } };
    }

    if (node.kind !== "IMAGE_GENERATOR") return node;

    const data = node.data as GeneratorNodeData;
    const sourceNodeId = data.sourceNodeId ? nodeIdRemap.get(data.sourceNodeId) ?? data.sourceNodeId : null;
    const referenceNodeIds = [
      ...new Set(data.referenceNodeIds.map((referenceNodeId) => nodeIdRemap.get(referenceNodeId) ?? referenceNodeId)),
    ].slice(0, 5);

    return {
      ...node,
      data: {
        ...data,
        sourceNodeId,
        referenceNodeIds,
      } satisfies GeneratorNodeData,
    };
  });
}

function cloneCanvasNodes(nodes: CanvasNode[]) {
  return nodes.map((node) => {
    if (node.kind === "IMAGE_GENERATOR") {
      const data = node.data as GeneratorNodeData;
      return { ...node, data: { ...data, referenceNodeIds: [...data.referenceNodeIds] } } as CanvasNode;
    }

    return { ...node, data: { ...node.data } } as CanvasNode;
  });
}

function makeHistorySnapshot(
  nodes: CanvasNode[],
  hiddenGenerationIds: string[],
  hiddenNodeIds: string[],
): FlowHistorySnapshot {
  return {
    nodes: cloneCanvasNodes(nodes),
    hiddenGenerationIds: [...hiddenGenerationIds],
    hiddenNodeIds: [...hiddenNodeIds],
  };
}

function historySnapshotSignature(snapshot: FlowHistorySnapshot) {
  return JSON.stringify(snapshot, (key, value) => {
    if (key === "localFile" && value) {
      const file = value as File;
      return {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      };
    }
    return value;
  });
}

function mergeSavedDraftNodes(base: CanvasNode[], savedDraftNodes: CanvasNode[]) {
  const saved = savedDraftNodes.map(rehydrateDraftNode);
  const hasSavedWorkflow = saved.some(
    (node) => node.kind === "TEXT" || node.kind === "ASSISTANT" || node.kind === "IMAGE_GENERATOR",
  );
  const savedById = new Map(saved.map((node) => [node.id, node]));

  const mergedBase = base
    .filter((node) => {
      if (getNodeGenerationId(node)) return true;
      if (!hasSavedWorkflow) return true;
      return node.kind === "IMAGE";
    })
    .map((node) => savedById.get(node.id) ?? node);

  const mergedIds = new Set(mergedBase.map((node) => node.id));
  for (const node of saved) {
    if (!mergedIds.has(node.id)) {
      mergedBase.push(node);
      mergedIds.add(node.id);
    }
  }

  return dedupeFlowImageNodes(mergedBase);
}

function generationAttemptKey(generation: FlowGeneration) {
  const references = generation.referenceImages
    .map((reference) => `${reference.fileName.trim().toLowerCase()}::${reference.mimeType.trim().toLowerCase()}`)
    .sort()
    .join("|");

  return [
    generation.sourceAssetId,
    generation.userInstruction.trim(),
    generation.preserveMode,
    generation.preserveEverythingElse ? "1" : "0",
    references,
  ].join("::");
}

function getVisibleFlowGenerations(generations: FlowGeneration[]) {
  const latestIndexByAttempt = new Map<string, number>();

  for (let index = 0; index < generations.length; index += 1) {
    latestIndexByAttempt.set(generationAttemptKey(generations[index]!), index);
  }

  return generations.filter((generation, index) => {
    if (generation.status !== "FAILED" && generation.status !== "CANCELED") return true;

    const latestIndex = latestIndexByAttempt.get(generationAttemptKey(generation));
    return latestIndex === undefined || latestIndex === index;
  });
}

function makeInitialNodes(data: FlowData): CanvasNode[] {
  const visibleGenerations = getVisibleFlowGenerations(data.generations);

  if (visibleGenerations.length > 0) {
    const historyNodes = visibleGenerations.flatMap((generation, index) => makeGenerationNodes(generation, index));
    const visibleAssetIds = new Set(
      historyNodes
        .filter((node) => node.kind === "IMAGE")
        .map((node) => (node.data as ImageNodeData).asset?.id)
        .filter((id): id is string => Boolean(id)),
    );
    const historicalReferencePaths = new Set(
      visibleGenerations.flatMap((generation) => generation.referenceImages.map((reference) => reference.filePath)),
    );
    const historicalReferenceIdentities = new Set(
      visibleGenerations.flatMap((generation) =>
        generation.referenceImages.map(
          (reference) => `${reference.fileName.trim().toLowerCase()}::${reference.mimeType.trim().toLowerCase()}`,
        ),
      ),
    );
    const looseFlowInputs = data.session.assets.filter((asset) => {
      if (asset.type !== "FLOW_INPUT" || visibleAssetIds.has(asset.id)) return false;
      if (historicalReferencePaths.has(asset.filePath)) return false;

      const identity = `${asset.fileName.trim().toLowerCase()}::${asset.mimeType.trim().toLowerCase()}`;
      return !historicalReferenceIdentities.has(identity);
    });

    looseFlowInputs.forEach((asset, index) => {
      historyNodes.push(
        makeImageNode({
          id: `flow-input-${asset.id}`,
          x: 45 + (index % 3) * 275,
          y: 1100 + Math.floor(index / 3) * 245,
          title: `Flow Image #${index + 1}`,
          asset,
          role: "IMAGE",
        }),
      );
    });

    return dedupeFlowImageNodes(historyNodes);
  }

  const source = data.session.assets.find((asset) => asset.type === "ORIGINAL") ?? data.session.assets[0];
  if (!source) return [];

  const sourceId = `draft-source-${source.id}`;
  const textId = `draft-text-${crypto.randomUUID()}`;
  const assistantId = `draft-assistant-${crypto.randomUUID()}`;
  const generatorId = `draft-generator-${crypto.randomUUID()}`;

  const initialNodes: CanvasNode[] = [
    makeImageNode({
      id: sourceId,
      x: 330,
      y: 525,
      title: "Source Image #1",
      asset: source,
      role: "SOURCE",
    }),
    {
      id: textId,
      kind: "TEXT",
      x: 330,
      y: 190,
      width: TEXT_SIZE.width,
      height: TEXT_SIZE.height,
      data: {
        title: "Text #1",
        text: "",
      } satisfies TextNodeData,
    },
    {
      id: assistantId,
      kind: "ASSISTANT",
      x: 840,
      y: 180,
      width: ASSISTANT_SIZE.width,
      height: ASSISTANT_SIZE.height,
      data: {
        title: "Assistant #1",
        textNodeId: textId,
        outputText: "",
        state: "IDLE",
        errorMessage: null,
        includeReferences: false,
      } satisfies AssistantNodeData,
    },
    {
      id: generatorId,
      kind: "IMAGE_GENERATOR",
      x: 1305,
      y: 170,
      width: GENERATOR_SIZE.width,
      height: GENERATOR_SIZE.height,
      data: {
        title: "Image Generator #1",
        promptNodeId: assistantId,
        sourceNodeId: sourceId,
        referenceNodeIds: [],
        preserveMode: "STRICT",
        preserveEverythingElse: true,
        status: "DRAFT",
        progressMessage: null,
        errorMessage: null,
        outputAsset: null,
      } satisfies GeneratorNodeData,
    },
  ];

  data.session.assets
    .filter((asset) => asset.type === "FLOW_INPUT")
    .forEach((asset, index) => {
      initialNodes.push(
        makeImageNode({
          id: `flow-input-${asset.id}`,
          x: 45 + (index % 3) * 275,
          y: 800 + Math.floor(index / 3) * 245,
          title: `Flow Image #${index + 1}`,
          asset,
          role: "IMAGE",
        }),
      );
    });

  return initialNodes;
}

export function RenderFlowEditor({ projectId, sessionId }: RenderFlowEditorProps) {
  const router = useRouter();
  const refinePrompt = useRefineFlowPrompt();
  const createImageGeneration = useCreateFlowImageGeneration();
  const retryGeneration = useRetryGeneration();
  const cancelGeneration = useCancelGeneration();
  const chatGPTStatus = useChatGPTStatus();
  const geminiStatus = useGeminiStatus();
  const addBackgroundGeneration = useGenerationActivityStore((state) => state.addBackgroundGeneration);

  const viewportRef = useRef<HTMLDivElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const referenceDropPointRef = useRef({ x: 360, y: 720 });
  const referenceTargetGeneratorRef = useRef<string | null>(null);
  const undoStackRef = useRef<FlowHistorySnapshot[]>([]);
  const redoStackRef = useRef<FlowHistorySnapshot[]>([]);
  const currentHistorySnapshotRef = useRef<FlowHistorySnapshot | null>(null);
  const historyTimerRef = useRef<number | null>(null);
  const historyReadyRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const suppressNextHistoryRef = useRef(false);
  const preparedImageDragsRef = useRef(
    new Map<string, { filePath: string; iconPath?: string | null }>(),
  );
  const preparingImageDragsRef = useRef(new Set<string>());

  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const selectedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  const setSelectedNodeId = useCallback((nodeId: string | null) => {
    setSelectedNodeIds(nodeId ? [nodeId] : []);
  }, []);
  const [hiddenGenerationIds, setHiddenGenerationIds] = useState<string[]>([]);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([]);
  const [camera, setCamera] = useState<Camera>({ x: 70, y: 55, zoom: 0.82 });
  const [tool, setTool] = useState<ToolMode>("SELECT");
  const [nodeDrag, setNodeDrag] = useState<NodeDrag>(null);
  const [selectionDrag, setSelectionDrag] = useState<SelectionDrag>(null);
  const [panDrag, setPanDrag] = useState<PanDrag>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection>(null);
  const [pointerWorld, setPointerWorld] = useState({ x: 0, y: 0 });
  const [addMenu, setAddMenu] = useState<AddMenuState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const flowQuery = useQuery({
    queryKey: ["render-flow", projectId, sessionId],
    queryFn: () => apiGet<FlowData>(`/api/projects/${projectId}/image-sessions/${sessionId}/flow`),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.generations.some((generation) => ACTIVE_STATUSES.has(generation.status)) ? 1_800 : false;
    },
    staleTime: 800,
  });

  const flowData = flowQuery.data;
  const visibleFlowGenerations = useMemo(
    () => getVisibleFlowGenerations(flowData?.generations ?? []),
    [flowData],
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const selectedGroupBounds = useMemo(() => {
    if (selectedNodeIds.length < 2) return null;

    const selectedNodes = selectedNodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is CanvasNode => Boolean(node));

    if (selectedNodes.length < 2) return null;

    const padding = 18;
    const left = Math.min(...selectedNodes.map((node) => node.x)) - padding;
    const top = Math.min(...selectedNodes.map((node) => node.y)) - padding;
    const right = Math.max(...selectedNodes.map((node) => node.x + node.width)) + padding;
    const bottom = Math.max(...selectedNodes.map((node) => node.y + node.height)) + padding;

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }, [nodeById, selectedNodeIds]);

  const generationById = useMemo(
    () => new Map((flowData?.generations ?? []).map((generation) => [generation.id, generation])),
    [flowData],
  );

  const updateNode = useCallback(<T,>(nodeId: string, updater: (data: T) => T) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: updater(node.data as T) as CanvasNode["data"],
            }
          : node,
      ),
    );
  }, []);

  useEffect(() => {
    if (!flowData) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      const initial = makeInitialNodes(flowData);

      const saved = window.localStorage.getItem(`eskander-flow-layout:${projectId}:${sessionId}`);
      let hydrated = initial;

      if (saved) {
        try {
          const parsed = JSON.parse(saved) as {
            camera?: Camera;
            positions?: Record<string, { x: number; y: number }>;
            draftNodes?: CanvasNode[];
            hiddenGenerationIds?: string[];
            hiddenNodeIds?: string[];
          };

          if (parsed.camera) setCamera(parsed.camera);
          if (Array.isArray(parsed.hiddenGenerationIds)) {
            setHiddenGenerationIds(parsed.hiddenGenerationIds);
            hydrated = hydrated.filter((node) => {
              const generationId = getNodeGenerationId(node);
              return !generationId || !parsed.hiddenGenerationIds!.includes(generationId);
            });
          }
          if (Array.isArray(parsed.hiddenNodeIds)) {
            setHiddenNodeIds(parsed.hiddenNodeIds);
            const hiddenNodes = new Set(parsed.hiddenNodeIds);
            hydrated = hydrated.filter((node) => !hiddenNodes.has(node.id));
          }
          if (Array.isArray(parsed.draftNodes) && parsed.draftNodes.length > 0) {
            hydrated = mergeSavedDraftNodes(hydrated, parsed.draftNodes);
          }
          if (parsed.positions) {
            for (const node of hydrated) {
              const position = parsed.positions[node.id];
              if (position) {
                node.x = position.x;
                node.y = position.y;
              }
            }
          }
        } catch {
          // A stale layout should never block the flow editor.
        }
      }

      setNodes(hydrated);
      return;
    }

    suppressNextHistoryRef.current = true;
    setNodes((current) => {
      const representedGenerationIds = new Set<string>();
      for (const node of current) {
        const generationId =
          node.kind === "TEXT"
            ? (node.data as TextNodeData).generationId
            : node.kind === "ASSISTANT"
              ? (node.data as AssistantNodeData).generationId
              : node.kind === "IMAGE_GENERATOR"
                ? (node.data as GeneratorNodeData).generationId
                : (node.data as ImageNodeData).generationId;
        if (generationId) representedGenerationIds.add(generationId);
      }

      const synced = current.map((node) => {
        const generationId =
          node.kind === "TEXT"
            ? (node.data as TextNodeData).generationId
            : node.kind === "ASSISTANT"
              ? (node.data as AssistantNodeData).generationId
              : node.kind === "IMAGE_GENERATOR"
                ? (node.data as GeneratorNodeData).generationId
                : (node.data as ImageNodeData).generationId;

        if (!generationId) return node;
        const generation = generationById.get(generationId);
        if (!generation) return node;

        if (node.kind === "TEXT") {
          return {
            ...node,
            data: {
              ...(node.data as TextNodeData),
              text: generation.userInstruction,
            },
          };
        }

        if (node.kind === "ASSISTANT") {
          const previous = node.data as AssistantNodeData;
          return {
            ...node,
            data: {
              ...previous,
              outputText: generation.refinedPrompt ?? previous.outputText,
              state: generation.refinedPrompt ? "READY" : previous.state,
              errorMessage: generation.refinedPrompt ? null : previous.errorMessage,
            },
          };
        }

        if (node.kind === "IMAGE_GENERATOR") {
          return {
            ...node,
            data: {
              ...(node.data as GeneratorNodeData),
              status: generation.status,
              progressMessage: generation.progressMessage,
              errorMessage: generation.errorMessage,
              outputAsset: generation.outputAsset,
            },
          };
        }

        return node;
      });

      const hidden = new Set(hiddenGenerationIds);
      const hiddenNodes = new Set(hiddenNodeIds);
      const missing = visibleFlowGenerations.filter(
        (generation) => !representedGenerationIds.has(generation.id) && !hidden.has(generation.id),
      );
      if (missing.length === 0) return dedupeFlowImageNodes(synced);

      const baseIndex = visibleFlowGenerations.length - missing.length;
      return dedupeFlowImageNodes([
        ...synced,
        ...missing
          .flatMap((generation, index) => makeGenerationNodes(generation, baseIndex + index))
          .filter((node) => !hiddenNodes.has(node.id)),
      ]);
    });
  }, [flowData, generationById, hiddenGenerationIds, hiddenNodeIds, projectId, sessionId, visibleFlowGenerations]);

  useEffect(() => {
    if (!initializedRef.current) return;

    const id = window.setTimeout(() => {
      const positions = Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
      const draftNodes = nodes
        .map(serializeDraftNode)
        .filter((node): node is CanvasNode => Boolean(node));

      window.localStorage.setItem(
        `eskander-flow-layout:${projectId}:${sessionId}`,
        JSON.stringify({ camera, positions, draftNodes, hiddenGenerationIds, hiddenNodeIds }),
      );
    }, 250);

    return () => window.clearTimeout(id);
  }, [camera, hiddenGenerationIds, hiddenNodeIds, nodes, projectId, sessionId]);

  useEffect(() => {
    if (!initializedRef.current) return;

    const snapshot = makeHistorySnapshot(nodes, hiddenGenerationIds, hiddenNodeIds);

    if (!historyReadyRef.current) {
      historyReadyRef.current = true;
      currentHistorySnapshotRef.current = snapshot;
      return;
    }

    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      currentHistorySnapshotRef.current = snapshot;
      return;
    }

    if (suppressNextHistoryRef.current) {
      suppressNextHistoryRef.current = false;
      currentHistorySnapshotRef.current = snapshot;
      return;
    }

    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
    }

    historyTimerRef.current = window.setTimeout(() => {
      historyTimerRef.current = null;
      const previous = currentHistorySnapshotRef.current;
      if (!previous) {
        currentHistorySnapshotRef.current = snapshot;
        return;
      }

      if (historySnapshotSignature(previous) === historySnapshotSignature(snapshot)) return;

      undoStackRef.current.push(previous);
      if (undoStackRef.current.length > 80) undoStackRef.current.shift();
      redoStackRef.current = [];
      currentHistorySnapshotRef.current = snapshot;
      setHistoryVersion((value) => value + 1);
    }, 260);

    return () => {
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
    };
  }, [hiddenGenerationIds, hiddenNodeIds, nodes]);

  useEffect(() => {
    return () => {
      if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!nodeDrag && !panDrag && !selectionDrag) return;

    function handlePointerMove(event: PointerEvent) {
      if (nodeDrag) {
        const dx = (event.clientX - nodeDrag.startClientX) / camera.zoom;
        const dy = (event.clientY - nodeDrag.startClientY) / camera.zoom;
        const draggedIds = new Set(nodeDrag.nodeIds);

        setNodes((current) =>
          current.map((node) => {
            if (!draggedIds.has(node.id)) return node;
            const start = nodeDrag.startPositions[node.id];
            if (!start) return node;
            return {
              ...node,
              x: start.x + dx,
              y: start.y + dy,
            };
          }),
        );
      }

      if (panDrag) {
        setCamera((current) => ({
          ...current,
          x: panDrag.startX + event.clientX - panDrag.startClientX,
          y: panDrag.startY + event.clientY - panDrag.startClientY,
        }));
      }

      if (selectionDrag) {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const currentX = (event.clientX - rect.left - camera.x) / camera.zoom;
        const currentY = (event.clientY - rect.top - camera.y) / camera.zoom;
        setSelectionDrag((current) =>
          current
            ? {
                ...current,
                currentX,
                currentY,
              }
            : null,
        );
      }
    }

    function handlePointerUp() {
      if (selectionDrag) {
        const left = Math.min(selectionDrag.startX, selectionDrag.currentX);
        const right = Math.max(selectionDrag.startX, selectionDrag.currentX);
        const top = Math.min(selectionDrag.startY, selectionDrag.currentY);
        const bottom = Math.max(selectionDrag.startY, selectionDrag.currentY);
        const width = right - left;
        const height = bottom - top;

        if (width > 6 || height > 6) {
          const hits = nodes
            .filter(
              (node) =>
                node.x < right &&
                node.x + node.width > left &&
                node.y < bottom &&
                node.y + node.height > top,
            )
            .map((node) => node.id);

          setSelectedNodeIds(
            selectionDrag.additive
              ? [...new Set([...selectionDrag.initialSelection, ...hits])]
              : hits,
          );
        }
      }

      setNodeDrag(null);
      setPanDrag(null);
      setSelectionDrag(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [camera.zoom, nodeDrag, panDrag, selectionDrag]);

  function applyHistorySnapshot(snapshot: FlowHistorySnapshot) {
    applyingHistoryRef.current = true;
    setNodes(cloneCanvasNodes(snapshot.nodes));
    setHiddenGenerationIds([...snapshot.hiddenGenerationIds]);
    setHiddenNodeIds([...snapshot.hiddenNodeIds]);
    setSelectedNodeIds([]);
    setPendingConnection(null);
    setAddMenu(null);
    setSelectionDrag(null);
    setNodeDrag(null);
  }

  function undoFlow() {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }

    const live = makeHistorySnapshot(nodes, hiddenGenerationIds, hiddenNodeIds);
    const committed = currentHistorySnapshotRef.current;
    let target: FlowHistorySnapshot | undefined;

    if (committed && historySnapshotSignature(live) !== historySnapshotSignature(committed)) {
      target = committed;
    } else {
      target = undoStackRef.current.pop();
    }

    if (!target) return;

    redoStackRef.current.push(live);
    if (redoStackRef.current.length > 80) redoStackRef.current.shift();
    currentHistorySnapshotRef.current = makeHistorySnapshot(
      target.nodes,
      target.hiddenGenerationIds,
      target.hiddenNodeIds,
    );
    applyHistorySnapshot(target);
    setHistoryVersion((value) => value + 1);
  }

  function redoFlow() {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }

    const target = redoStackRef.current.pop();
    if (!target) return;

    const live = makeHistorySnapshot(nodes, hiddenGenerationIds, hiddenNodeIds);
    undoStackRef.current.push(live);
    if (undoStackRef.current.length > 80) undoStackRef.current.shift();
    currentHistorySnapshotRef.current = makeHistorySnapshot(
      target.nodes,
      target.hiddenGenerationIds,
      target.hiddenNodeIds,
    );
    applyHistorySnapshot(target);
    setHistoryVersion((value) => value + 1);
  }

  const liveHistorySnapshot = makeHistorySnapshot(nodes, hiddenGenerationIds, hiddenNodeIds);
  const canUndo =
    undoStackRef.current.length > 0 ||
    Boolean(
      currentHistorySnapshotRef.current &&
        historySnapshotSignature(liveHistorySnapshot) !== historySnapshotSignature(currentHistorySnapshotRef.current),
    );
  const canRedo = redoStackRef.current.length > 0;
  void historyVersion;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isEditing = tagName === "TEXTAREA" || tagName === "INPUT" || tagName === "SELECT" || Boolean(target?.isContentEditable);

      if (event.code === "Space" && !event.repeat && !isEditing) {
        setSpaceHeld(true);
      }

      const commandKey = event.ctrlKey || event.metaKey;
      const lowerKey = event.key.toLowerCase();
      if (commandKey && !event.altKey && !isEditing && lowerKey === "z") {
        event.preventDefault();
        if (event.shiftKey) redoFlow();
        else undoFlow();
        return;
      }

      if (commandKey && !event.altKey && !event.shiftKey && !isEditing && lowerKey === "y") {
        event.preventDefault();
        redoFlow();
        return;
      }

      if (event.key === "Escape") {
        setPendingConnection(null);
        setAddMenu(null);
        setSelectionDrag(null);
        setSelectedNodeIds([]);
      }

      if ((event.key === "Delete" || event.key === "Backspace") && !isEditing && selectedNodeIds.length > 0) {
        event.preventDefault();
        removeNodes(selectedNodeIds);
        return;
      }

      if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditing) {
        event.preventDefault();
        fitView();
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHeld(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  });

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!window.eskanderStudio?.desktop) return;

    for (const node of nodes) {
      if (node.kind !== "IMAGE_GENERATOR") continue;
      const asset = (node.data as GeneratorNodeData).outputAsset;
      if (!asset) continue;
      if (preparedImageDragsRef.current.has(asset.id)) continue;
      if (preparingImageDragsRef.current.has(asset.id)) continue;

      void prepareGeneratorImageDrag(asset);
    }
  }, [nodes]);

  const edges = useMemo(() => {
    const result: CanvasEdge[] = [];

    for (const node of nodes) {
      if (node.kind === "ASSISTANT") {
        const data = node.data as AssistantNodeData;
        if (data.textNodeId) {
          result.push({
            id: `${data.textNodeId}-${node.id}-text`,
            fromId: data.textNodeId,
            toId: node.id,
            target: "ASSISTANT_TEXT",
          });
        }
      }

      if (node.kind === "IMAGE_GENERATOR") {
        const data = node.data as GeneratorNodeData;
        if (data.promptNodeId) {
          result.push({
            id: `${data.promptNodeId}-${node.id}-prompt`,
            fromId: data.promptNodeId,
            toId: node.id,
            target: "GENERATOR_PROMPT",
          });
        }
        if (data.sourceNodeId) {
          result.push({
            id: `${data.sourceNodeId}-${node.id}-source`,
            fromId: data.sourceNodeId,
            toId: node.id,
            target: "GENERATOR_SOURCE",
          });
        }
        data.referenceNodeIds.forEach((referenceNodeId, referenceIndex) => {
          result.push({
            id: `${referenceNodeId}-${node.id}-reference-${referenceIndex}`,
            fromId: referenceNodeId,
            toId: node.id,
            target: "GENERATOR_REFERENCE",
            referenceIndex,
          });
        });
      }
    }

    return result;
  }, [nodes]);

  function screenToWorld(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: (clientX - left - camera.x) / camera.zoom,
      y: (clientY - top - camera.y) / camera.zoom,
    };
  }

  function startNodeDrag(event: ReactPointerEvent, node: CanvasNode) {
    if (pendingConnection) return;
    if (event.button !== 0 || tool === "PAN" || spaceHeld) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, textarea, input, select, [data-native-image-drag]")) return;

    event.preventDefault();
    event.stopPropagation();

    let dragIds: string[];
    if (event.shiftKey) {
      const next = selectedNodeIds.includes(node.id)
        ? selectedNodeIds.filter((id) => id !== node.id)
        : [...selectedNodeIds, node.id];
      setSelectedNodeIds(next);
      dragIds = next.includes(node.id) ? next : [];
    } else if (selectedNodeIds.includes(node.id)) {
      dragIds = selectedNodeIds;
    } else {
      dragIds = [node.id];
      setSelectedNodeIds([node.id]);
    }

    if (dragIds.length === 0) return;

    setAddMenu(null);
    setNodeDrag({
      nodeIds: dragIds,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPositions: Object.fromEntries(
        nodes
          .filter((candidate) => dragIds.includes(candidate.id))
          .map((candidate) => [candidate.id, { x: candidate.x, y: candidate.y }]),
      ),
    });
  }

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const isPan = tool === "PAN" || spaceHeld || event.button === 1;
    if (isPan) {
      event.preventDefault();
      setPanDrag({
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: camera.x,
        startY: camera.y,
      });
      return;
    }

    if (event.button !== 0) return;

    setError(null);

    if (pendingConnection) {
      const world = screenToWorld(event.clientX, event.clientY);
      setAddMenu({
        screenX: event.clientX,
        screenY: event.clientY,
        worldX: world.x,
        worldY: world.y,
        pending: pendingConnection,
      });
      return;
    }

    setAddMenu(null);
    const world = screenToWorld(event.clientX, event.clientY);

    if (
      !event.shiftKey &&
      selectedGroupBounds &&
      world.x >= selectedGroupBounds.left &&
      world.x <= selectedGroupBounds.right &&
      world.y >= selectedGroupBounds.top &&
      world.y <= selectedGroupBounds.bottom
    ) {
      event.preventDefault();
      setNodeDrag({
        nodeIds: [...selectedNodeIds],
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPositions: Object.fromEntries(
          nodes
            .filter((node) => selectedNodeIds.includes(node.id))
            .map((node) => [node.id, { x: node.x, y: node.y }]),
        ),
      });
      return;
    }

    const initialSelection = event.shiftKey ? selectedNodeIds : [];

    if (!event.shiftKey) setSelectedNodeIds([]);

    setSelectionDrag({
      startX: world.x,
      startY: world.y,
      currentX: world.x,
      currentY: world.y,
      additive: event.shiftKey,
      initialSelection,
    });
  }

  function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (pendingConnection) setPointerWorld(screenToWorld(event.clientX, event.clientY));
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();

    if (event.ctrlKey || event.metaKey) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;

      const before = screenToWorld(event.clientX, event.clientY);
      const nextZoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.0018), MIN_ZOOM, MAX_ZOOM);
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      setCamera({
        zoom: nextZoom,
        x: localX - before.x * nextZoom,
        y: localY - before.y * nextZoom,
      });
      return;
    }

    setCamera((current) => ({
      ...current,
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  }

  function zoomBy(amount: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const worldX = (centerX - camera.x) / camera.zoom;
    const worldY = (centerY - camera.y) / camera.zoom;
    const nextZoom = clamp(camera.zoom + amount, MIN_ZOOM, MAX_ZOOM);
    setCamera({
      zoom: nextZoom,
      x: centerX - worldX * nextZoom,
      y: centerY - worldY * nextZoom,
    });
  }

  function fitView() {
    const viewport = viewportRef.current;
    if (!viewport || nodes.length === 0) return;

    const rect = viewport.getBoundingClientRect();
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const zoom = clamp(Math.min((rect.width - 180) / contentWidth, (rect.height - 150) / contentHeight), 0.45, 1.05);

    setCamera({
      zoom,
      x: (rect.width - contentWidth * zoom) / 2 - minX * zoom,
      y: (rect.height - contentHeight * zoom) / 2 - minY * zoom,
    });
  }

  function resetLayout() {
    if (!flowData) return;
    for (const node of nodes) {
      if (node.kind === "IMAGE") {
        const data = node.data as ImageNodeData;
        if (data.localFile) URL.revokeObjectURL(data.previewUrl);
      }
    }
    window.localStorage.removeItem(`eskander-flow-layout:${projectId}:${sessionId}`);
    setHiddenGenerationIds([]);
    setHiddenNodeIds([]);
    setNodes(makeInitialNodes(flowData));
    setCamera({ x: 70, y: 55, zoom: 0.82 });
    setSelectedNodeId(null);
  }

  function startConnection(event: ReactMouseEvent, node: CanvasNode, outputType: OutputType) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNodeId(node.id);
    setPendingConnection({ fromNodeId: node.id, outputType });
    const point = getNodeOutputPoint(node);
    setPointerWorld({ x: point.x + 120, y: point.y });
    setError(null);
  }

  function connectAssistantText(assistantId: string) {
    if (!pendingConnection) return;
    const source = nodeById.get(pendingConnection.fromNodeId);
    if (!source || source.kind !== "TEXT" || pendingConnection.outputType !== "TEXT") {
      setError("Assistant accepts a Text node as its prompt input.");
      return;
    }

    updateNode<AssistantNodeData>(assistantId, (data) => ({
      ...data,
      textNodeId: source.id,
      state: "IDLE",
      outputText: "",
      errorMessage: null,
    }));
    setPendingConnection(null);
    setError(null);
  }

  function connectGeneratorInput(generatorId: string, input: GeneratorInput) {
    if (!pendingConnection) return;
    const source = nodeById.get(pendingConnection.fromNodeId);
    if (!source) return;

    if (input === "PROMPT") {
      if (source.kind !== "ASSISTANT" || pendingConnection.outputType !== "TEXT") {
        setError("Image Generator prompt must come from an Assistant node.");
        return;
      }
      updateNode<GeneratorNodeData>(generatorId, (data) => ({ ...data, promptNodeId: source.id }));
    } else {
      if ((source.kind !== "IMAGE" && source.kind !== "IMAGE_GENERATOR") || pendingConnection.outputType !== "IMAGE") {
        setError("This port accepts an image output.");
        return;
      }

      if (source.kind === "IMAGE_GENERATOR" && !(source.data as GeneratorNodeData).outputAsset) {
        setError("Run that Image Generator first so it has an image output.");
        return;
      }

      if (input === "SOURCE") {
        if (source.kind === "IMAGE" && !(source.data as ImageNodeData).asset) {
          setError("Uploaded reference nodes are reference-only. Use a saved render version as the Source image.");
          return;
        }
        updateNode<GeneratorNodeData>(generatorId, (data) => ({ ...data, sourceNodeId: source.id }));
      } else {
        updateNode<GeneratorNodeData>(generatorId, (data) => ({
          ...data,
          referenceNodeIds: [...new Set([...data.referenceNodeIds, source.id])].slice(0, 5),
        }));
      }
    }

    setPendingConnection(null);
    setError(null);
  }

  function nextTitle(kind: NodeKind) {
    const count = nodes.filter((node) => node.kind === kind).length + 1;
    if (kind === "TEXT") return `Text #${count}`;
    if (kind === "ASSISTANT") return `Assistant #${count}`;
    if (kind === "IMAGE_GENERATOR") return `Image Generator #${count}`;
    return `Image #${count}`;
  }

  function rectanglesOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
    margin = AUTO_LAYOUT_MARGIN,
  ) {
    return !(
      a.x + a.width + margin <= b.x ||
      b.x + b.width + margin <= a.x ||
      a.y + a.height + margin <= b.y ||
      b.y + b.height + margin <= a.y
    );
  }

  function isNodeRectFree(rect: { x: number; y: number; width: number; height: number }, ignoreNodeIds: string[] = []) {
    const ignored = new Set(ignoreNodeIds);
    return nodes.every((node) => {
      if (ignored.has(node.id)) return true;
      return !rectanglesOverlap(rect, node);
    });
  }

  function findFreeNodePosition(x: number, y: number, width: number, height: number) {
    let candidateX = Math.max(24, x);
    let candidateY = Math.max(24, y);

    for (let row = 0; row < 40; row += 1) {
      const rect = { x: candidateX, y: candidateY, width, height };
      if (isNodeRectFree(rect)) {
        return { x: candidateX, y: candidateY };
      }
      candidateY += height + AUTO_LAYOUT_ROW_GAP;
      if (candidateY + height > WORLD_HEIGHT - 80) {
        candidateY = Math.max(24, y);
        candidateX += width + AUTO_LAYOUT_COLUMN_GAP;
      }
    }

    return { x: candidateX, y: candidateY };
  }

  function findFreePipelinePosition(x: number, y: number) {
    const offsets = [
      { x: 0, y: 0, width: TEXT_SIZE.width, height: TEXT_SIZE.height },
      { x: 510, y: -10, width: ASSISTANT_SIZE.width, height: ASSISTANT_SIZE.height },
      { x: 975, y: -20, width: GENERATOR_SIZE.width, height: GENERATOR_SIZE.height },
    ];

    let candidateX = Math.max(24, x);
    let candidateY = Math.max(120, y);

    for (let row = 0; row < 40; row += 1) {
      const blocked = offsets.some((offset) =>
        !isNodeRectFree({
          x: candidateX + offset.x,
          y: candidateY + offset.y,
          width: offset.width,
          height: offset.height,
        }),
      );

      if (!blocked) {
        return { x: candidateX, y: candidateY };
      }

      candidateY += Math.max(TEXT_SIZE.height, ASSISTANT_SIZE.height, GENERATOR_SIZE.height) + AUTO_LAYOUT_ROW_GAP;
      if (candidateY + GENERATOR_SIZE.height > WORLD_HEIGHT - 80) {
        candidateY = Math.max(120, y);
        candidateX += TEXT_SIZE.width + ASSISTANT_SIZE.width + GENERATOR_SIZE.width + AUTO_LAYOUT_COLUMN_GAP;
      }
    }

    return { x: candidateX, y: candidateY };
  }

  function createTextNode(x: number, y: number) {
    const id = `draft-text-${crypto.randomUUID()}`;
    const position = findFreeNodePosition(x, y, TEXT_SIZE.width, TEXT_SIZE.height);
    setNodes((current) => [
      ...current,
      {
        id,
        kind: "TEXT",
        x: position.x,
        y: position.y,
        width: TEXT_SIZE.width,
        height: TEXT_SIZE.height,
        data: { title: nextTitle("TEXT"), text: "" } satisfies TextNodeData,
      },
    ]);
    setSelectedNodeId(id);
    return id;
  }

  function createAssistantNode(x: number, y: number, textNodeId: string | null = null) {
    const id = `draft-assistant-${crypto.randomUUID()}`;
    const position = findFreeNodePosition(x, y, ASSISTANT_SIZE.width, ASSISTANT_SIZE.height);
    setNodes((current) => [
      ...current,
      {
        id,
        kind: "ASSISTANT",
        x: position.x,
        y: position.y,
        width: ASSISTANT_SIZE.width,
        height: ASSISTANT_SIZE.height,
        data: {
          title: nextTitle("ASSISTANT"),
          textNodeId,
          outputText: "",
          state: "IDLE",
          errorMessage: null,
          includeReferences: false,
        } satisfies AssistantNodeData,
      },
    ]);
    setSelectedNodeId(id);
    return id;
  }

  function createGeneratorNode(x: number, y: number, promptNodeId: string | null = null, sourceNodeId: string | null = null) {
    const id = `draft-generator-${crypto.randomUUID()}`;
    const position = findFreeNodePosition(x, y, GENERATOR_SIZE.width, GENERATOR_SIZE.height);
    setNodes((current) => [
      ...current,
      {
        id,
        kind: "IMAGE_GENERATOR",
        x: position.x,
        y: position.y,
        width: GENERATOR_SIZE.width,
        height: GENERATOR_SIZE.height,
        data: {
          title: nextTitle("IMAGE_GENERATOR"),
          promptNodeId,
          sourceNodeId,
          referenceNodeIds: [],
          preserveMode: "STRICT",
          preserveEverythingElse: true,
          status: "DRAFT",
          progressMessage: null,
          errorMessage: null,
          outputAsset: null,
        } satisfies GeneratorNodeData,
      },
    ]);
    setSelectedNodeId(id);
    return id;
  }

  function createPipeline(x: number, y: number, preferredSourceNodeId: string | null = null) {
    const latestGenerator = [...nodes]
      .reverse()
      .find((node) => node.kind === "IMAGE_GENERATOR" && Boolean((node.data as GeneratorNodeData).outputAsset));
    const preferredSource = preferredSourceNodeId ? nodeById.get(preferredSourceNodeId) ?? null : null;
    const fallbackSource = nodes.find((node) => node.kind === "IMAGE" && Boolean((node.data as ImageNodeData).asset)) ?? null;
    const sourceImage = preferredSource ?? latestGenerator ?? fallbackSource;

    const rightMostEdge = nodes.length > 0
      ? Math.max(...nodes.map((node) => node.x + node.width))
      : x;
    const topMostNode = nodes.length > 0
      ? Math.min(...nodes.map((node) => node.y))
      : y;
    const desiredX = Math.max(x, rightMostEdge + 180);
    const desiredY = Math.max(120, Math.min(y, topMostNode + 80));
    const { x: pipelineX, y: pipelineY } = findFreePipelinePosition(desiredX, desiredY);

    const textId = `draft-text-${crypto.randomUUID()}`;
    const assistantId = `draft-assistant-${crypto.randomUUID()}`;
    const generatorId = `draft-generator-${crypto.randomUUID()}`;
    const sourceCloneId = `draft-source-${crypto.randomUUID()}`;
    const number = nodes.filter((node) => node.kind === "IMAGE_GENERATOR").length + 1;
    const nextSourceCount = nodes.filter((node) => node.kind === "IMAGE" && (node.data as ImageNodeData).role === "SOURCE").length + 1;

    const clonedSourceAsset =
      sourceImage?.kind === "IMAGE_GENERATOR"
        ? (sourceImage.data as GeneratorNodeData).outputAsset ?? null
        : sourceImage?.kind === "IMAGE"
          ? (sourceImage.data as ImageNodeData).asset ?? null
          : null;

    const cloneGeneratedSource = Boolean(preferredSourceNodeId && preferredSource?.kind === "IMAGE_GENERATOR" && clonedSourceAsset);
    const sourceNodeIdForGenerator = cloneGeneratedSource ? sourceCloneId : sourceImage?.id ?? null;

    setNodes((current) => {
      const nextNodes: CanvasNode[] = [...current];

      if (cloneGeneratedSource && clonedSourceAsset) {
        const sourcePosition = findFreeNodePosition(pipelineX - IMAGE_SIZE.width - 85, pipelineY + 120, IMAGE_SIZE.width, IMAGE_SIZE.height);
        nextNodes.push(
          makeImageNode({
            id: sourceCloneId,
            x: sourcePosition.x,
            y: sourcePosition.y,
            title: imageTitle(nextSourceCount, "SOURCE"),
            asset: clonedSourceAsset,
            role: "SOURCE",
          }),
        );
      }

      nextNodes.push(
        {
          id: textId,
          kind: "TEXT",
          x: pipelineX,
          y: pipelineY,
          width: TEXT_SIZE.width,
          height: TEXT_SIZE.height,
          data: { title: `Text #${number}`, text: "" } satisfies TextNodeData,
        },
        {
          id: assistantId,
          kind: "ASSISTANT",
          x: pipelineX + 510,
          y: pipelineY - 10,
          width: ASSISTANT_SIZE.width,
          height: ASSISTANT_SIZE.height,
          data: {
            title: `Assistant #${number}`,
            textNodeId: textId,
            outputText: "",
            state: "IDLE",
            errorMessage: null,
            includeReferences: false,
          } satisfies AssistantNodeData,
        },
        {
          id: generatorId,
          kind: "IMAGE_GENERATOR",
          x: pipelineX + 975,
          y: pipelineY - 20,
          width: GENERATOR_SIZE.width,
          height: GENERATOR_SIZE.height,
          data: {
            title: `Image Generator #${number}`,
            promptNodeId: assistantId,
            sourceNodeId: sourceNodeIdForGenerator,
            referenceNodeIds: [],
            preserveMode: "STRICT",
            preserveEverythingElse: true,
            status: "DRAFT",
            progressMessage: null,
            errorMessage: null,
            outputAsset: null,
          } satisfies GeneratorNodeData,
        },
      );

      return nextNodes;
    });

    setSelectedNodeId(textId);
    setAddMenu(null);
  }

  function addFromMenu(kind: "TEXT" | "ASSISTANT" | "IMAGE_GENERATOR" | "REFERENCE" | "PIPELINE") {
    if (!addMenu) return;
    const { worldX, worldY, pending } = addMenu;

    if (kind === "PIPELINE") {
      const source = pending ? nodeById.get(pending.fromNodeId) : null;
      const preferredSourceNodeId =
        pending?.outputType === "IMAGE" && (source?.kind === "IMAGE" || source?.kind === "IMAGE_GENERATOR")
          ? source.id
          : null;
      createPipeline(worldX, worldY, preferredSourceNodeId);
      setPendingConnection(null);
      return;
    }

    if (kind === "REFERENCE") {
      referenceDropPointRef.current = { x: worldX, y: worldY };
      referenceTargetGeneratorRef.current = null;
      referenceInputRef.current?.click();
      setAddMenu(null);
      return;
    }

    if (kind === "TEXT") {
      createTextNode(worldX, worldY);
      setPendingConnection(null);
    }

    if (kind === "ASSISTANT") {
      const textNodeId = pending && pending.outputType === "TEXT" && nodeById.get(pending.fromNodeId)?.kind === "TEXT"
        ? pending.fromNodeId
        : null;
      createAssistantNode(worldX, worldY, textNodeId);
      setPendingConnection(null);
    }

    if (kind === "IMAGE_GENERATOR") {
      const source = pending ? nodeById.get(pending.fromNodeId) : null;
      const promptNodeId = source?.kind === "ASSISTANT" && pending?.outputType === "TEXT" ? source.id : null;
      const sourceNodeId =
        (source?.kind === "IMAGE" || source?.kind === "IMAGE_GENERATOR") && pending?.outputType === "IMAGE"
          ? source.id
          : null;
      createGeneratorNode(worldX, worldY, promptNodeId, sourceNodeId);
      setPendingConnection(null);
    }

    setAddMenu(null);
  }

  function openGenericAddMenu(event: ReactMouseEvent) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const screenX = rect.left + 78;
    const screenY = rect.top + 88;
    const world = screenToWorld(screenX, screenY);
    setAddMenu({ screenX, screenY, worldX: world.x, worldY: world.y, pending: null });
  }

  function openReferencePicker(generatorId: string) {
    const generator = nodeById.get(generatorId);
    if (!generator) return;
    referenceDropPointRef.current = { x: generator.x - 330, y: generator.y + 215 };
    referenceTargetGeneratorRef.current = generatorId;
    referenceInputRef.current?.click();
  }

  async function handleReferenceFiles(files: FileList | null) {
    if (!files) return;

    const targetGeneratorId = referenceTargetGeneratorRef.current;
    const generator = targetGeneratorId ? nodeById.get(targetGeneratorId) : null;
    const currentReferenceCount = generator?.kind === "IMAGE_GENERATOR"
      ? (generator.data as GeneratorNodeData).referenceNodeIds.length
      : 0;
    const room = Math.max(0, 5 - currentReferenceCount);
    const accepted = Array.from(files)
      .filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type))
      .slice(0, targetGeneratorId ? room : 5);

    if (accepted.length === 0) {
      if (targetGeneratorId && room === 0) {
        setError("This Image Generator already has the maximum of 5 reference images.");
      } else {
        setError("Choose a PNG, JPG, or WEBP image.");
      }
      referenceTargetGeneratorRef.current = null;
      return;
    }

    setError(null);
    setToast(accepted.length === 1 ? "Uploading image..." : `Uploading ${accepted.length} images...`);

    try {
      const uploadedAssets = await Promise.all(
        accepted.map(async (file) => {
          const formData = new FormData();
          formData.append("image", file);
          return apiUpload<Asset>(
            `/api/projects/${projectId}/image-sessions/${sessionId}/flow/images`,
            formData,
          );
        }),
      );

      const createdNodes = uploadedAssets.map((asset, index) =>
        makeImageNode({
          id: `flow-input-${asset.id}`,
          x: referenceDropPointRef.current.x - index * 28,
          y: referenceDropPointRef.current.y + index * 52,
          title: targetGeneratorId
            ? `Reference #${currentReferenceCount + index + 1}`
            : `Flow Image #${nodes.filter((node) => node.kind === "IMAGE").length + index + 1}`,
          asset,
          role: targetGeneratorId ? "REFERENCE" : "IMAGE",
        }),
      );

      setNodes((current) => [...current, ...createdNodes]);

      if (targetGeneratorId) {
        updateNode<GeneratorNodeData>(targetGeneratorId, (data) => ({
          ...data,
          referenceNodeIds: [...data.referenceNodeIds, ...createdNodes.map((node) => node.id)].slice(0, 5),
        }));
      }

      if (createdNodes[0]) setSelectedNodeId(createdNodes[0].id);
      setToast(accepted.length === 1 ? "Image added to Flow" : `${accepted.length} images added to Flow`);

      // Keep the session's asset list in sync so Reset Flow / refresh can rebuild these image nodes.
      await flowQuery.refetch();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the flow image.");
      setToast(null);
    } finally {
      referenceTargetGeneratorRef.current = null;
    }
  }

  function resolveSourceAsset(nodeId: string | null) {
    if (!nodeId) return null;
    const node = nodeById.get(nodeId);
    if (!node) return null;
    if (node.kind === "IMAGE") return (node.data as ImageNodeData).asset ?? null;
    if (node.kind === "IMAGE_GENERATOR") return (node.data as GeneratorNodeData).outputAsset ?? null;
    return null;
  }

  function collectReferenceIds(referenceNodeIds: string[]) {
    const assetIds: string[] = [];
    const referenceImageIds: string[] = [];

    for (const referenceNodeId of referenceNodeIds.slice(0, 5)) {
      const node = nodeById.get(referenceNodeId);
      if (!node) continue;

      if (node.kind === "IMAGE") {
        const image = node.data as ImageNodeData;
        if (image.asset?.id) {
          assetIds.push(image.asset.id);
          continue;
        }
        if (image.referenceImageId) {
          referenceImageIds.push(image.referenceImageId);
        }
      }

      if (node.kind === "IMAGE_GENERATOR") {
        const output = (node.data as GeneratorNodeData).outputAsset;
        if (output?.id) assetIds.push(output.id);
      }
    }

    const uniqueAssetIds = [...new Set(assetIds)];
    const uniqueReferenceIds = [...new Set(referenceImageIds)];
    const room = Math.max(0, 5 - uniqueAssetIds.length);

    return {
      referenceAssetIds: uniqueAssetIds.slice(0, 5),
      referenceImageIds: uniqueReferenceIds.slice(0, room),
    };
  }

  function downstreamGeneratorForAssistant(assistantId: string) {
    return nodes.find(
      (node) => node.kind === "IMAGE_GENERATOR" && (node.data as GeneratorNodeData).promptNodeId === assistantId,
    );
  }

  async function runAssistant(node: CanvasNode) {
    if (!flowData || node.kind !== "ASSISTANT") return;
    const assistant = node.data as AssistantNodeData;

    if (chatGPTStatus.data && !chatGPTStatus.data.connected) {
      setError("ChatGPT is not connected. Open Settings and reconnect ChatGPT first.");
      return;
    }

    const textNode = assistant.textNodeId ? nodeById.get(assistant.textNodeId) : null;
    const instruction = textNode?.kind === "TEXT" ? (textNode.data as TextNodeData).text.trim() : "";

    if (!instruction) {
      setError("Connect a Text node and write the instruction first.");
      return;
    }

    const downstreamGenerator = downstreamGeneratorForAssistant(node.id);
    const generatorData = downstreamGenerator?.kind === "IMAGE_GENERATOR"
      ? (downstreamGenerator.data as GeneratorNodeData)
      : null;
    const sourceAsset = resolveSourceAsset(generatorData?.sourceNodeId ?? null)
      ?? flowData.session.assets.find((asset) => asset.type === "ORIGINAL")
      ?? flowData.session.assets[0];

    if (!sourceAsset) {
      setError("The Assistant needs a source image context for this render session.");
      return;
    }

    updateNode<AssistantNodeData>(node.id, (data) => ({
      ...data,
      state: "RUNNING",
      errorMessage: null,
    }));
    setError(null);

    try {
      const references = assistant.includeReferences
        ? collectReferenceIds(generatorData?.referenceNodeIds ?? [])
        : { referenceAssetIds: [], referenceImageIds: [] };
      const result = await refinePrompt.mutateAsync({
        projectId,
        sessionId,
        sourceAssetId: sourceAsset.id,
        instruction,
        preserveMode: generatorData?.preserveMode ?? "STRICT",
        preserveEverythingElse: generatorData?.preserveEverythingElse ?? true,
        includeReferencesInAssistant: assistant.includeReferences,
        ...references,
      });

      updateNode<AssistantNodeData>(node.id, (data) => ({
        ...data,
        outputText: result.prompt,
        state: "READY",
        errorMessage: null,
      }));
      setToast("Assistant prompt is ready");
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "ChatGPT Assistant failed.";
      updateNode<AssistantNodeData>(node.id, (data) => ({ ...data, state: "ERROR", errorMessage: message }));
      setError(message);
    }
  }

  async function runGenerator(node: CanvasNode) {
    if (!flowData || node.kind !== "IMAGE_GENERATOR") return;

    if (geminiStatus.data && !geminiStatus.data.connected) {
      setError("Gemini is not connected. Open Settings and reconnect Gemini first.");
      return;
    }

    const generator = node.data as GeneratorNodeData;
    const assistantNode = generator.promptNodeId ? nodeById.get(generator.promptNodeId) : null;
    if (!assistantNode || assistantNode.kind !== "ASSISTANT") {
      setError("Connect an Assistant node to the prompt port first.");
      return;
    }

    const assistant = assistantNode.data as AssistantNodeData;
    if (!assistant.outputText.trim()) {
      setError("Run the connected Assistant first so the refined prompt is ready.");
      return;
    }

    const textNode = assistant.textNodeId ? nodeById.get(assistant.textNodeId) : null;
    const instruction = textNode?.kind === "TEXT" ? (textNode.data as TextNodeData).text.trim() : "";
    if (!instruction) {
      setError("The connected Assistant has no Text input.");
      return;
    }

    const sourceAsset = resolveSourceAsset(generator.sourceNodeId);
    if (!sourceAsset) {
      setError("Connect a saved source image or a completed generator to the Source image port.");
      return;
    }

    const existingGeneration = generator.generationId ? generationById.get(generator.generationId) : null;
    const canRetryExisting = Boolean(
      existingGeneration &&
        (existingGeneration.status === "FAILED" || existingGeneration.status === "CANCELED") &&
        !existingGeneration.outputAsset &&
        existingGeneration.sourceAssetId === sourceAsset.id &&
        existingGeneration.userInstruction.trim() === instruction &&
        existingGeneration.refinedPrompt?.trim() === assistant.outputText.trim() &&
        existingGeneration.preserveMode === generator.preserveMode &&
        existingGeneration.preserveEverythingElse === generator.preserveEverythingElse,
    );

    if (canRetryExisting && existingGeneration) {
      setError(null);
      updateNode<GeneratorNodeData>(node.id, (data) => ({
        ...data,
        status: "GENERATING",
        progressMessage: "Retrying Gemini...",
        errorMessage: null,
        outputAsset: null,
      }));

      try {
        const result = await retryGeneration.mutateAsync(existingGeneration.id);
        addBackgroundGeneration(result.id);
        updateNode<GeneratorNodeData>(node.id, (data) => ({
          ...data,
          generationId: result.id,
          status: result.status,
          progressMessage: result.progressMessage,
          errorMessage: result.errorMessage,
          outputAsset: null,
        }));
        setToast("Gemini generation retry started");
        await flowQuery.refetch();
        return;
      } catch (retryError) {
        const message = retryError instanceof Error ? retryError.message : "Could not retry Gemini.";
        updateNode<GeneratorNodeData>(node.id, (data) => ({
          ...data,
          status: "FAILED",
          errorMessage: message,
          progressMessage: null,
        }));
        setError(message);
        return;
      }
    }

    setError(null);
    updateNode<GeneratorNodeData>(node.id, (data) => ({
      ...data,
      status: "GENERATING",
      progressMessage: "Preparing Gemini...",
      errorMessage: null,
      outputAsset: null,
    }));

    try {
      const references = collectReferenceIds(generator.referenceNodeIds);
      const result = await createImageGeneration.mutateAsync({
        projectId,
        sessionId,
        sourceAssetId: sourceAsset.id,
        instruction,
        refinedPrompt: assistant.outputText,
        preserveMode: generator.preserveMode,
        preserveEverythingElse: generator.preserveEverythingElse,
        ...references,
      });

      addBackgroundGeneration(result.id);

      updateNode<GeneratorNodeData>(node.id, (data) => ({
        ...data,
        generationId: result.id,
        status: result.status,
        progressMessage: result.progressMessage,
        errorMessage: result.errorMessage,
        outputAsset: null,
      }));
      updateNode<AssistantNodeData>(assistantNode.id, (data) => ({ ...data, generationId: result.id }));
      if (textNode?.kind === "TEXT") {
        updateNode<TextNodeData>(textNode.id, (data) => ({ ...data, generationId: result.id }));
      }

      setToast("Gemini generation started");
      await flowQuery.refetch();
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Could not start Gemini.";
      updateNode<GeneratorNodeData>(node.id, (data) => ({
        ...data,
        status: "FAILED",
        errorMessage: message,
        progressMessage: null,
      }));
      setError(message);
    }
  }

  async function stopGenerator(node: CanvasNode) {
    if (node.kind !== "IMAGE_GENERATOR") return;
    const data = node.data as GeneratorNodeData;
    if (!data.generationId) return;

    try {
      await cancelGeneration.mutateAsync(data.generationId);
      updateNode<GeneratorNodeData>(node.id, (current) => ({
        ...current,
        status: "CANCELED",
        progressMessage: "Generation canceled.",
      }));
      setToast("Generation canceled");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel generation.");
    }
  }

  function duplicateNode(node: CanvasNode) {
    const id = `draft-${node.kind.toLowerCase()}-${crypto.randomUUID()}`;
    const copy: CanvasNode = {
      ...node,
      id,
      x: node.x + 48,
      y: node.y + 48,
      data: { ...node.data },
    };

    if (copy.kind === "TEXT") {
      copy.data = { ...(copy.data as TextNodeData), generationId: undefined };
    } else if (copy.kind === "IMAGE") {
      const image = copy.data as ImageNodeData;
      copy.data = {
        ...image,
        generationId: undefined,
        previewUrl: image.localFile ? URL.createObjectURL(image.localFile) : image.previewUrl,
      };
    } else if (copy.kind === "ASSISTANT") {
      copy.data = {
        ...(copy.data as AssistantNodeData),
        generationId: undefined,
        state: "READY",
        errorMessage: null,
      };
    } else if (copy.kind === "IMAGE_GENERATOR") {
      copy.data = {
        ...(copy.data as GeneratorNodeData),
        generationId: undefined,
        status: "DRAFT",
        progressMessage: null,
        errorMessage: null,
        outputAsset: null,
      };
    }

    setNodes((current) => [...current, copy]);
    setSelectedNodeId(id);
  }

  function removeNodes(nodeIds: string[]) {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;

    const nodesToRemove = nodes.filter((node) => ids.has(node.id));

    for (const node of nodesToRemove) {
      if (node.kind === "IMAGE") {
        const image = node.data as ImageNodeData;
        if (image.localFile) URL.revokeObjectURL(image.previewUrl);
      }

      if (node.kind === "IMAGE_GENERATOR") {
        const generator = node.data as GeneratorNodeData;
        if (generator.generationId && ACTIVE_STATUSES.has(generator.status)) {
          void cancelGeneration.mutateAsync(generator.generationId).catch(() => undefined);
        }
      }
    }

    const affectedGenerationIds = new Set(
      nodesToRemove
        .map(getNodeGenerationId)
        .filter((id): id is string => Boolean(id)),
    );

    const fullyRemovedGenerationIds = [...affectedGenerationIds].filter((generationId) =>
      nodes
        .filter((node) => getNodeGenerationId(node) === generationId)
        .every((node) => ids.has(node.id)),
    );

    if (fullyRemovedGenerationIds.length > 0) {
      setHiddenGenerationIds((current) => [...new Set([...current, ...fullyRemovedGenerationIds])]);
    }

    const removedPersistentNodeIds = nodesToRemove
      .filter((node) => {
        if (getNodeGenerationId(node)) return true;
        if (node.kind !== "IMAGE") return false;
        const image = node.data as ImageNodeData;
        return Boolean(image.asset || image.remoteFilePath || image.referenceImageId);
      })
      .map((node) => node.id);
    if (removedPersistentNodeIds.length > 0) {
      setHiddenNodeIds((current) => [...new Set([...current, ...removedPersistentNodeIds])]);
    }

    setNodes((current) =>
      current
        .filter((item) => !ids.has(item.id))
        .map((item) => {
          if (item.kind === "ASSISTANT") {
            const data = item.data as AssistantNodeData;
            return data.textNodeId && ids.has(data.textNodeId)
              ? { ...item, data: { ...data, textNodeId: null, state: "IDLE", outputText: "" } }
              : item;
          }

          if (item.kind === "IMAGE_GENERATOR") {
            const data = item.data as GeneratorNodeData;
            return {
              ...item,
              data: {
                ...data,
                promptNodeId: data.promptNodeId && ids.has(data.promptNodeId) ? null : data.promptNodeId,
                sourceNodeId: data.sourceNodeId && ids.has(data.sourceNodeId) ? null : data.sourceNodeId,
                referenceNodeIds: data.referenceNodeIds.filter((id) => !ids.has(id)),
              },
            };
          }

          return item;
        }),
    );

    setSelectedNodeIds((current) => current.filter((id) => !ids.has(id)));
  }

  function removeNode(node: CanvasNode) {
    removeNodes([node.id]);
  }

  function unlinkEdge(edge: CanvasEdge) {
    if (edge.target === "ASSISTANT_TEXT") {
      updateNode<AssistantNodeData>(edge.toId, (data) => ({
        ...data,
        textNodeId: null,
        outputText: "",
        state: "IDLE",
        errorMessage: null,
      }));
    } else if (edge.target === "GENERATOR_PROMPT") {
      updateNode<GeneratorNodeData>(edge.toId, (data) => ({ ...data, promptNodeId: null }));
    } else if (edge.target === "GENERATOR_SOURCE") {
      updateNode<GeneratorNodeData>(edge.toId, (data) => ({ ...data, sourceNodeId: null }));
    } else {
      updateNode<GeneratorNodeData>(edge.toId, (data) => ({
        ...data,
        referenceNodeIds: data.referenceNodeIds.filter((referenceNodeId) => referenceNodeId !== edge.fromId),
      }));
    }

    setPendingConnection(null);
    setAddMenu(null);
    setToast("Connection removed");
  }

  function renderActionBar(node: CanvasNode) {
    if (selectedNodeId !== node.id) return null;

    const multipleSelected = selectedNodeIds.length > 1;
    const canRun = !multipleSelected && (node.kind === "ASSISTANT" || node.kind === "IMAGE_GENERATOR");
    const generatorActive =
      node.kind === "IMAGE_GENERATOR" && ACTIVE_STATUSES.has((node.data as GeneratorNodeData).status);
    const canConnect =
      !multipleSelected &&
      (node.kind === "TEXT" ||
        node.kind === "ASSISTANT" ||
        node.kind === "IMAGE" ||
        (node.kind === "IMAGE_GENERATOR" && Boolean((node.data as GeneratorNodeData).outputAsset)));
    return (
      <div
        className="absolute left-1/2 top-[-58px] z-30 flex -translate-x-1/2 items-center rounded-[11px] border border-white/[0.1] bg-[#1a1a1c]/98 p-1 shadow-[0_12px_30px_rgba(0,0,0,0.4)] backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {multipleSelected && (
          <span className="px-2.5 text-[13px] font-medium text-white/65">{selectedNodeIds.length} selected</span>
        )}

        {canRun && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (node.kind === "ASSISTANT") void runAssistant(node);
              else if (generatorActive) void stopGenerator(node);
              else void runGenerator(node);
            }}
            className="flex h-9 w-10 items-center justify-center rounded-lg text-white hover:bg-white/[0.08]"
            title={generatorActive ? "Stop" : "Run"}
          >
            {generatorActive ? <Square size={14} fill="currentColor" /> : <CirclePlay size={17} fill="currentColor" />}
          </button>
        )}

        {canConnect && (
          <button
            type="button"
            onClick={(event) =>
              startConnection(event, node, node.kind === "TEXT" || node.kind === "ASSISTANT" ? "TEXT" : "IMAGE")
            }
            className="flex h-9 w-10 items-center justify-center rounded-lg text-white/75 hover:bg-white/[0.08] hover:text-white"
            title="Connect output"
          >
            <Link2 size={16} />
          </button>
        )}

        {!multipleSelected && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              duplicateNode(node);
            }}
            className="flex h-9 w-10 items-center justify-center rounded-lg text-white/75 hover:bg-white/[0.08] hover:text-white"
            title="Duplicate"
          >
            <Copy size={15} />
          </button>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (multipleSelected) removeNodes(selectedNodeIds);
            else removeNode(node);
          }}
          className="flex h-9 w-10 items-center justify-center rounded-lg text-white/75 hover:bg-red-500/10 hover:text-red-300"
          title={multipleSelected ? "Delete selected" : "Delete node"}
        >
          <Trash2 size={15} />
        </button>
      </div>
    );
  }

  function renderPort(input: {
    node: CanvasNode;
    side: "LEFT" | "RIGHT";
    top: number;
    type: OutputType;
    label: string;
    onClick: (event: ReactMouseEvent) => void;
    keyValue?: string;
    miniLabel?: string;
    miniLabelTone?: "source" | "reference" | "neutral";
  }) {
    const { node, side, top, type, label, onClick, keyValue, miniLabel, miniLabelTone = "neutral" } = input;
    const miniLabelClass =
      miniLabelTone === "source"
        ? "border-emerald-400/20 bg-emerald-400/12 text-emerald-200/95"
        : miniLabelTone === "reference"
          ? "border-sky-400/20 bg-sky-400/12 text-sky-200/95"
          : "border-white/[0.08] bg-white/[0.06] text-white/72";

    return (
      <>
        <button
          key={keyValue}
          type="button"
          title={label}
          aria-label={label}
          onClick={onClick}
          className={[
            "absolute z-20 flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.1] bg-[#252527] text-[13px] text-white/75 shadow-[0_7px_18px_rgba(0,0,0,0.35)] transition",
            side === "LEFT" ? "-left-[43px]" : "-right-[43px]",
            pendingConnection ? "hover:border-[#9e77ff] hover:bg-[#302740]" : "hover:bg-[#303033]",
          ].join(" ")}
          style={{ top }}
        >
          {type === "TEXT" ? <Type size={14} /> : <FileImage size={14} />}
        </button>
        {miniLabel ? (
          <div
            className={[
              "pointer-events-none absolute z-10 flex h-5 items-center rounded-md border px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] shadow-[0_6px_18px_rgba(0,0,0,0.2)]",
              miniLabelClass,
              side === "LEFT" ? "left-1" : "right-1",
            ].join(" ")}
            style={{ top: top + 7 }}
          >
            {miniLabel}
          </div>
        ) : null}
      </>
    );
  }

  function nodeShell(node: CanvasNode, children: ReactNode, className = "") {
    const selected = selectedNodeIds.includes(node.id);
    return (
      <div
        key={node.id}
        className="absolute"
        style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
        onClick={(event) => {
          event.stopPropagation();

          if (!selected) setSelectedNodeIds([node.id]);
          setAddMenu(null);
        }}
      >
        <div
          className="absolute -top-[33px] left-0 flex cursor-grab select-none items-center gap-2 rounded-md px-1 py-1 text-[14px] font-medium text-white/92 active:cursor-grabbing"
          onPointerDown={(event) => startNodeDrag(event, node)}
          title="Drag node"
        >
          <GripVertical size={14} className="text-white/30" />
          {node.kind === "TEXT" && <Type size={13} />}
          {node.kind === "ASSISTANT" && <Sparkles size={13} />}
          {node.kind === "IMAGE_GENERATOR" && <FileImage size={13} />}
          {node.kind === "IMAGE" && <FileImage size={13} />}
          <span>{(node.data as { title: string }).title}</span>
        </div>

        {renderActionBar(node)}

        <div
          className={[
            "relative h-full w-full overflow-visible rounded-[14px] border bg-[#1a1a1c] shadow-[0_22px_55px_rgba(0,0,0,0.24)] transition-[border-color,box-shadow]",
            selected
              ? "border-[#4b94ff] shadow-[0_0_0_2px_rgba(75,148,255,0.72),0_22px_55px_rgba(0,0,0,0.34)]"
              : "border-white/[0.12] hover:border-white/[0.22]",
            className,
          ].join(" ")}
          onPointerDown={(event) => startNodeDrag(event, node)}
        >
          {children}
        </div>
      </div>
    );
  }

  function renderTextNode(node: CanvasNode) {
    const data = node.data as TextNodeData;

    return nodeShell(
      node,
      <>
        <div
          className="flex h-11 cursor-grab select-none items-center justify-between border-b border-white/[0.055] px-4 text-[13px] text-white/38 active:cursor-grabbing"
          onPointerDown={(event) => startNodeDrag(event, node)}
        >
          <span>Instruction</span>
          <span className="text-[13px] text-white/22">Drag here to move</span>
        </div>

        <textarea
          value={data.text}
          onChange={(event) => {
            updateNode<TextNodeData>(node.id, (current) => ({ ...current, text: event.target.value }));
            const assistants = nodes.filter(
              (candidate) => candidate.kind === "ASSISTANT" && (candidate.data as AssistantNodeData).textNodeId === node.id,
            );
            for (const assistant of assistants) {
              updateNode<AssistantNodeData>(assistant.id, (current) => ({
                ...current,
                state: "IDLE",
                outputText: "",
                errorMessage: null,
              }));
            }
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (!selectedNodeIds.includes(node.id)) setSelectedNodeIds([node.id]);
          }}
          onClick={(event) => event.stopPropagation()}
          placeholder="Write the edit you want. Example: Change only the background color to burgundy and keep everything else unchanged."
          className="h-[calc(100%-44px)] w-full resize-none rounded-b-[13px] bg-transparent px-5 py-4 text-[17px] leading-7 text-white/92 outline-none placeholder:text-white/26"
        />

        {renderPort({
          node,
          side: "RIGHT",
          top: 60,
          type: "TEXT",
          label: "Text output",
          onClick: (event) => startConnection(event, node, "TEXT"),
        })}
      </>,
    );
  }

  function renderAssistantNode(node: CanvasNode) {
    const data = node.data as AssistantNodeData;
    const running = data.state === "RUNNING";
    const downstreamGenerator = downstreamGeneratorForAssistant(node.id);
    const referenceCount =
      downstreamGenerator?.kind === "IMAGE_GENERATOR"
        ? (downstreamGenerator.data as GeneratorNodeData).referenceNodeIds.length
        : 0;

    return nodeShell(
      node,
      <>
        <div className="flex h-12 items-center justify-between px-4 pt-1">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-white/60">
              <Bot size={17} />
            </span>
            <span className="rounded-md bg-[#8a5df6]/15 px-2.5 py-1 text-[13px] font-medium text-[#c7b2ff]">
              ChatGPT
            </span>
          </div>
          <div className="flex items-center gap-1 text-white/35">
            {data.state === "READY" && <Check size={16} className="text-emerald-400" />}
            {data.state === "ERROR" && <AlertCircle size={16} className="text-red-400" />}
          </div>
        </div>

        <div className="h-[247px] px-5 pt-2">
          {running ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-white/48">
              <LoaderCircle size={24} className="animate-spin" />
              <p className="text-[14px]">ChatGPT is building the refined prompt...</p>
            </div>
          ) : (
            <textarea
              value={data.outputText}
              onChange={(event) =>
                updateNode<AssistantNodeData>(node.id, (current) => ({
                  ...current,
                  outputText: event.target.value,
                  state: event.target.value.trim() ? "READY" : "IDLE",
                  errorMessage: null,
                }))
              }
              onPointerDown={(event) => {
                event.stopPropagation();
                if (!selectedNodeIds.includes(node.id)) setSelectedNodeIds([node.id]);
              }}
              placeholder="Run Assistant to turn the Text instruction into the final production prompt Gemini will use. You can edit the result here before generating."
              className="h-full w-full resize-none bg-transparent text-[15px] leading-[1.68] text-white/86 outline-none placeholder:text-white/34"
            />
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 flex h-[62px] items-center justify-between border-t border-white/[0.05] px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                updateNode<AssistantNodeData>(node.id, (current) => ({
                  ...current,
                  includeReferences: !current.includeReferences,
                  state: "IDLE",
                }));
              }}
              className="flex h-9 items-center gap-2 rounded-lg bg-white/[0.04] px-3 text-[13px] text-white/66 hover:bg-white/[0.07]"
              title="Off by default. When enabled, ChatGPT also analyzes the references connected to the downstream generator. Gemini always receives the references directly."
            >
              <span
                className={[
                  "relative h-4 w-7 rounded-full transition",
                  data.includeReferences ? "bg-[#705cff]" : "bg-white/[0.13]",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-[2px] h-3 w-3 rounded-full bg-white transition",
                    data.includeReferences ? "left-[12px]" : "left-[2px]",
                  ].join(" ")}
                />
              </span>
              Analyze refs{referenceCount > 0 ? ` (${referenceCount})` : ""}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                router.push("/settings");
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/42 hover:bg-white/[0.05] hover:text-white/72"
              title="ChatGPT settings"
            >
              <Settings size={14} />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!data.outputText.trim()}
              onClick={async (event) => {
                event.stopPropagation();
                if (!data.outputText.trim()) return;
                await navigator.clipboard.writeText(data.outputText);
                setToast("Prompt copied");
              }}
              className="text-[13px] text-white/48 hover:text-white/78 disabled:opacity-30"
            >
              Copy prompt
            </button>
            <button
              type="button"
              disabled={running}
              onClick={(event) => {
                event.stopPropagation();
                void runAssistant(node);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition hover:scale-105 disabled:opacity-40"
              title="Run Assistant"
            >
              {running ? <LoaderCircle size={15} className="animate-spin" /> : <CirclePlay size={18} fill="currentColor" />}
            </button>
          </div>
        </div>

        {data.errorMessage && (
          <div className="absolute bottom-[66px] left-4 right-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] leading-5 text-red-300">
            {data.errorMessage}
          </div>
        )}

        {renderPort({
          node,
          side: "LEFT",
          top: 54,
          type: "TEXT",
          label: "Text input",
          onClick: (event) => {
            event.stopPropagation();
            connectAssistantText(node.id);
          },
        })}
        {renderPort({
          node,
          side: "RIGHT",
          top: 54,
          type: "TEXT",
          label: "Refined prompt output",
          onClick: (event) => startConnection(event, node, "TEXT"),
        })}
      </>,
    );
  }

  async function saveGeneratorImage(asset: Asset) {
    try {
      if (!window.eskanderStudio?.desktop) {
        throw new Error("Eskander Studio desktop bridge is not available.");
      }

      const result = await window.eskanderStudio.saveImage(
        getAssetUrl(asset.filePath),
        asset.fileName || "eskander-render.png",
      );

      if (!result.canceled && result.success) {
        setToast("Image saved");
      }
    } catch (error) {
      console.error("Save image failed:", error);
      setError(error instanceof Error ? error.message : "Could not save image.");
    }
  }

  async function copyGeneratorImage(asset: Asset) {
    try {
      if (!window.eskanderStudio?.desktop) {
        throw new Error("Eskander Studio desktop bridge is not available.");
      }

      await window.eskanderStudio.copyImage(getAssetUrl(asset.filePath));
      setToast("Copied to clipboard");
    } catch (error) {
      console.error("Copy image failed:", error);
      setError(error instanceof Error ? error.message : "Could not copy image.");
    }
  }

  async function prepareGeneratorImageDrag(asset: Asset) {
    const cached = preparedImageDragsRef.current.get(asset.id);
    if (cached) return cached;

    if (!window.eskanderStudio?.desktop) return null;
    if (preparingImageDragsRef.current.has(asset.id)) return null;

    preparingImageDragsRef.current.add(asset.id);

    try {
      const result = await window.eskanderStudio.prepareImageDrag(
        getAssetUrl(asset.filePath),
        asset.fileName || "eskander-render.png",
      );

      if (!result.success || !result.filePath) return null;

      const prepared = {
        filePath: result.filePath,
        iconPath: result.iconPath ?? null,
      };
      preparedImageDragsRef.current.set(asset.id, prepared);
      return prepared;
    } catch (error) {
      console.error("Prepare image drag failed:", error);
      return null;
    } finally {
      preparingImageDragsRef.current.delete(asset.id);
    }
  }

  function startGeneratorImageDrag(event: ReactDragEvent<HTMLImageElement>, asset: Asset) {
    // Electron's native file drag replaces Chromium's normal image drag.
    event.preventDefault();
    event.stopPropagation();

    if (!window.eskanderStudio?.desktop) {
      setError("Eskander Studio desktop bridge is not available.");
      return;
    }

    const prepared = preparedImageDragsRef.current.get(asset.id);
    if (!prepared) {
      void prepareGeneratorImageDrag(asset);
      setToast("Preparing image for drag — grab it again in a moment");
      return;
    }

    window.eskanderStudio.startImageDrag(prepared.filePath, prepared.iconPath ?? null);
  }

  function renderGeneratorNode(node: CanvasNode) {
    const data = node.data as GeneratorNodeData;
    const active = ACTIVE_STATUSES.has(data.status);
    const completed = data.status === "COMPLETED" && data.outputAsset;
    const failed = data.status === "FAILED";
    const referenceCount = data.referenceNodeIds.length;
    const promptConnected = Boolean(data.promptNodeId);
    const sourceConnected = Boolean(data.sourceNodeId);

    return nodeShell(
      node,
      <>
        <div className="absolute inset-x-0 top-0 h-[284px] overflow-hidden rounded-t-[13px] bg-[#151517]">
          {completed ? (
            <div className="relative h-full w-full">
              <img
                data-native-image-drag
                draggable
                src={getAssetUrl(data.outputAsset!.filePath)}
                alt="Generated result"
                title="Drag the image itself into Photoshop or another app"
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={() => {
                  void prepareGeneratorImageDrag(data.outputAsset!);
                }}
                onDragStart={(event) => startGeneratorImageDrag(event, data.outputAsset!)}
                className="h-full w-full cursor-grab select-none object-contain active:cursor-grabbing"
              />
              <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/[0.1] bg-black/70 px-2.5 py-1 text-[12px] font-medium text-white/82 backdrop-blur">
                Ready · drag image
              </div>
              <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-xl border border-white/[0.08] bg-black/70 p-1 shadow-lg backdrop-blur">
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void saveGeneratorImage(data.outputAsset!);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/78 transition hover:bg-white/[0.08] hover:text-white"
                  title="Save image"
                >
                  <Download size={14} />
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyGeneratorImage(data.outputAsset!);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/78 transition hover:bg-white/[0.08] hover:text-white"
                  title="Copy image"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          ) : active ? (
            <div className="relative flex h-full flex-col items-center justify-center overflow-hidden text-white/48">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_90%,rgba(97,227,160,0.08),transparent_45%)]" />
              <LoaderCircle size={26} className="mb-3 animate-spin text-white/68" />
              <p className="text-[14px]">{data.progressMessage ?? "Gemini is generating your image..."}</p>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-white/[0.12]">
              <FileImage size={56} strokeWidth={1.2} />
              <span className="text-[13px]">Gemini output appears here</span>
            </div>
          )}
        </div>

        {active && <div className="pointer-events-none absolute inset-0 rounded-[14px] border border-emerald-400/50" />}

        <div className="absolute bottom-[64px] left-0 right-0 px-5 text-[13px] leading-5 text-white/48">
          {failed ? (
            <span className="text-red-300/95">{data.errorMessage ?? "Generation failed."}</span>
          ) : active ? (
            <span>{data.progressMessage ?? "Gemini is generating your image..."}</span>
          ) : (
            <span>
              {promptConnected ? "Prompt connected." : "Connect Assistant prompt."}{" "}
              {sourceConnected ? "Source ready." : "Add a source image."}{" "}
              {referenceCount > 0
                ? `${referenceCount} visual reference${referenceCount === 1 ? "" : "s"} will be sent directly to Gemini.`
                : "References are optional and go directly to Gemini."}
            </span>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 flex h-[60px] items-center justify-between border-t border-white/[0.05] px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative shrink-0">
              <select
                value={data.preserveMode}
                onChange={(event) =>
                  updateNode<GeneratorNodeData>(node.id, (current) => ({
                    ...current,
                    preserveMode: event.target.value as PreserveMode,
                    preserveEverythingElse: event.target.value === "NO_RESTRICTION" ? false : current.preserveEverythingElse,
                  }))
                }
                onPointerDown={(event) => event.stopPropagation()}
                className="h-9 appearance-none rounded-lg border border-white/[0.1] bg-[#202024] pl-3 pr-8 text-[13px] font-medium text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition hover:bg-[#25252a] focus:border-[#7c68ff]/55 focus:bg-[#25252a]"
                title="How strongly the prompt should preserve the original image"
              >
                <option value="STRICT">Strict</option>
                <option value="BALANCED">Balanced</option>
                <option value="CREATIVE">Creative</option>
                <option value="NO_RESTRICTION">Free</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/45" />
            </div>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (data.preserveMode === "NO_RESTRICTION") return;
                updateNode<GeneratorNodeData>(node.id, (current) => ({
                  ...current,
                  preserveEverythingElse: !current.preserveEverythingElse,
                }));
              }}
              className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#202024] px-3 text-[13px] text-white/72 transition hover:bg-[#25252a]"
              title="Preserve everything not explicitly requested to change"
            >
              <span
                className={[
                  "relative h-4 w-7 rounded-full transition",
                  data.preserveEverythingElse && data.preserveMode !== "NO_RESTRICTION" ? "bg-[#6557f6]" : "bg-white/[0.12]",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-[2px] h-3 w-3 rounded-full bg-white transition",
                    data.preserveEverythingElse && data.preserveMode !== "NO_RESTRICTION" ? "left-[12px]" : "left-[2px]",
                  ].join(" ")}
                />
              </span>
              Preserve rest
            </button>

            <button
              type="button"
              disabled={referenceCount >= 5}
              onClick={(event) => {
                event.stopPropagation();
                openReferencePicker(node.id);
              }}
              className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#202024] px-3 text-[13px] text-white/72 transition hover:bg-[#25252a] disabled:opacity-30"
              title="Upload a visual reference for Gemini"
            >
              <ImagePlus size={14} /> Refs {referenceCount}/5
            </button>
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (active) void stopGenerator(node);
              else void runGenerator(node);
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
            title={active ? "Stop generation" : "Generate image with Gemini"}
          >
            {active ? <Square size={14} fill="currentColor" /> : <CirclePlay size={19} fill="currentColor" />}
          </button>
        </div>

        {renderPort({
          node,
          side: "LEFT",
          top: 54,
          type: "TEXT",
          label: "Assistant prompt input",
          onClick: (event) => {
            event.stopPropagation();
            connectGeneratorInput(node.id, "PROMPT");
          },
        })}
        {renderPort({
          node,
          side: "LEFT",
          top: 108,
          type: "IMAGE",
          label: "Source image input",
          miniLabel: "SRC",
          miniLabelTone: "source",
          onClick: (event) => {
            event.stopPropagation();
            connectGeneratorInput(node.id, "SOURCE");
          },
        })}
        {renderPort({
          node,
          side: "LEFT",
          top: 158,
          type: "IMAGE",
          label: `Reference input (${referenceCount}/5)`,
          miniLabel: "REF",
          miniLabelTone: "reference",
          onClick: (event) => {
            event.stopPropagation();
            connectGeneratorInput(node.id, "REFERENCE");
          },
        })}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!data.outputAsset) {
              setError("Generate an image first before connecting this output.");
              return;
            }
            startConnection(event, node, "IMAGE");
          }}
          className="absolute -right-[43px] top-[54px] z-20 flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.1] bg-[#252527] text-white/75 shadow-[0_7px_18px_rgba(0,0,0,0.35)] hover:bg-[#303033]"
          title="Generated image output"
        >
          <FileImage size={14} />
        </button>
      </>,
      active ? "border-emerald-400/40 shadow-[0_0_30px_rgba(52,211,153,0.12),0_22px_55px_rgba(0,0,0,0.3)]" : "",
    );
  }

  function renderImageNode(node: CanvasNode) {
    const data = node.data as ImageNodeData;
    return nodeShell(
      node,
      <>
        <div className="flex h-[156px] items-center justify-center overflow-hidden rounded-t-[13px] bg-[#111113]">
          <img src={data.previewUrl} alt={data.fileName} className="h-full w-full object-contain" />
        </div>
        <div className="flex h-[47px] items-center justify-between gap-3 border-t border-white/[0.05] px-3.5">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-white/68">{data.fileName}</p>
            <p className="mt-0.5 text-[13px] uppercase tracking-[0.08em] text-white/30">{data.role.toLowerCase()}</p>
          </div>
          {data.localFile && <span className="rounded-md bg-[#6f55ff]/15 px-1.5 py-1 text-[13px] text-[#b9aaff]">LOCAL</span>}
        </div>

        {renderPort({
          node,
          side: "RIGHT",
          top: 75,
          type: "IMAGE",
          label: "Image output",
          onClick: (event) => startConnection(event, node, "IMAGE"),
        })}
      </>,
    );
  }

  function renderNode(node: CanvasNode) {
    if (node.kind === "TEXT") return renderTextNode(node);
    if (node.kind === "ASSISTANT") return renderAssistantNode(node);
    if (node.kind === "IMAGE_GENERATOR") return renderGeneratorNode(node);
    return renderImageNode(node);
  }

  const pendingStartPoint = pendingConnection
    ? (() => {
        const node = nodeById.get(pendingConnection.fromNodeId);
        return node ? getNodeOutputPoint(node) : null;
      })()
    : null;

  const chatConnected = Boolean(chatGPTStatus.data?.connected);
  const geminiConnected = Boolean(geminiStatus.data?.connected);

  if (flowQuery.isLoading) {
    return (
      <section className="flex h-screen min-w-0 flex-1 items-center justify-center bg-[#101011] text-sm text-white/45">
        <LoaderCircle size={18} className="mr-2 animate-spin" /> Loading Flow...
      </section>
    );
  }

  if (flowQuery.isError || !flowData) {
    return (
      <section className="flex h-screen min-w-0 flex-1 items-center justify-center bg-[#101011] text-sm text-red-300">
        Could not load render Flow.
      </section>
    );
  }

  return (
    <section className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-[#101011] text-white">
      <input
        ref={referenceInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          void handleReferenceFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <header className="relative z-50 flex h-[62px] shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#141416] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/projects/${projectId}/renders/${sessionId}`)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/62 hover:bg-white/[0.05] hover:text-white"
            title="Back to render workspace"
          >
            <ArrowLeft size={17} />
          </button>
          <span className="h-5 w-px bg-white/[0.07]" />
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-gradient-to-br from-orange-300 to-pink-500 text-[13px] text-black/80">E</span>
            <span className="max-w-[220px] truncate text-white/62">Eskander Plus Studio</span>
            <span className="text-white/20">›</span>
            <Link2 size={13} className="text-white/30" />
            <span className="max-w-[260px] truncate text-white/75">{flowData.session.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-[13px] text-white/50 lg:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${chatConnected ? "bg-emerald-400" : "bg-red-400"}`} />
            ChatGPT
          </div>
          <div className="hidden items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-[13px] text-white/50 lg:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${geminiConnected ? "bg-emerald-400" : "bg-red-400"}`} />
            Gemini
          </div>
          <span className="mx-1 h-5 w-px bg-white/[0.07]" />
          <button
            type="button"
            onClick={() => router.push("/settings")}
            className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 text-[13px] text-white/68 hover:bg-white/[0.06]"
          >
            <Settings size={14} /> Settings
          </button>
          <button
            type="button"
            onClick={fitView}
            className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-[13px] font-medium text-black hover:bg-white/90"
          >
            <Maximize2 size={13} /> Fit
          </button>
        </div>
      </header>

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[#101011]"
        style={{
          cursor: tool === "PAN" || spaceHeld ? (panDrag ? "grabbing" : "grab") : "default",
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,.075) 1px, transparent 1.2px)",
          backgroundSize: `${22 * camera.zoom}px ${22 * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onWheel={handleWheel}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: WORLD_WIDTH,
            height: WORLD_HEIGHT,
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {edges.map((edge) => {
              const from = nodeById.get(edge.fromId);
              const to = nodeById.get(edge.toId);
              if (!from || !to) return null;

              const start = getNodeOutputPoint(from);
              let end;
              if (edge.target === "ASSISTANT_TEXT") end = getAssistantInputPoint(to);
              else if (edge.target === "GENERATOR_PROMPT") end = getGeneratorInputPoint(to, "PROMPT");
              else if (edge.target === "GENERATOR_SOURCE") end = getGeneratorInputPoint(to, "SOURCE");
              else end = getGeneratorInputPoint(to, "REFERENCE", edge.referenceIndex ?? 0);

              const imageEdge = edge.target === "GENERATOR_SOURCE" || edge.target === "GENERATOR_REFERENCE";

              const path = curvePath(start.x, start.y, end.x, end.y);

              return (
                <g key={edge.id}>
                  <path
                    d={path}
                    fill="none"
                    stroke={imageEdge ? "rgba(125,111,173,.72)" : "rgba(151,103,255,.82)"}
                    strokeWidth={2.3}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke="rgba(255,255,255,0.001)"
                    strokeWidth={16}
                    strokeLinecap="round"
                    pointerEvents="stroke"
                    className="pointer-events-auto cursor-pointer"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      unlinkEdge(edge);
                    }}
                  >
                    <title>Click to unlink this connection</title>
                  </path>
                </g>
              );
            })}

            {pendingConnection && pendingStartPoint && (
              <path
                d={curvePath(pendingStartPoint.x, pendingStartPoint.y, pointerWorld.x, pointerWorld.y)}
                fill="none"
                stroke="rgba(156,111,255,.8)"
                strokeWidth={2}
                strokeDasharray="6 7"
                strokeLinecap="round"
              />
            )}
          </svg>

          {selectedGroupBounds && !selectionDrag && (
            <div
              className="pointer-events-none absolute z-[9] rounded-[18px] border border-[#5f9dff]/70 bg-[#4b94ff]/[0.025] shadow-[0_0_0_1px_rgba(75,148,255,0.08)]"
              style={{
                left: selectedGroupBounds.left,
                top: selectedGroupBounds.top,
                width: selectedGroupBounds.width,
                height: selectedGroupBounds.height,
              }}
            >
              <div className="absolute -top-7 left-0 rounded-md border border-[#5f9dff]/30 bg-[#141b27]/95 px-2 py-1 text-[11px] font-medium text-[#a8c8ff] shadow-lg">
                {selectedNodeIds.length} selected · drag anywhere inside
              </div>
            </div>
          )}

          {selectionDrag && (
            <div
              className="pointer-events-none absolute z-10 border border-[#5f9dff]/80 bg-[#4b94ff]/10"
              style={{
                left: Math.min(selectionDrag.startX, selectionDrag.currentX),
                top: Math.min(selectionDrag.startY, selectionDrag.currentY),
                width: Math.abs(selectionDrag.currentX - selectionDrag.startX),
                height: Math.abs(selectionDrag.currentY - selectionDrag.startY),
              }}
            />
          )}

          {nodes.map(renderNode)}
        </div>

        <div className="absolute left-4 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[14px] border border-white/[0.07] bg-[#18181a]/95 p-1.5 shadow-[0_18px_35px_rgba(0,0,0,.3)] backdrop-blur">
          <button
            type="button"
            onClick={openGenericAddMenu}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white/72 hover:bg-white/[0.06] hover:text-white"
            title="Add node"
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            onClick={() => setTool("SELECT")}
            className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${tool === "SELECT" ? "bg-white text-black" : "text-white/62 hover:bg-white/[0.06]"}`}
            title="Select"
          >
            <MousePointer2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => setTool("PAN")}
            className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${tool === "PAN" ? "bg-white text-black" : "text-white/62 hover:bg-white/[0.06]"}`}
            title="Pan"
          >
            <Hand size={16} />
          </button>
          <span className="my-1 h-px w-6 bg-white/[0.07]" />
          <button
            type="button"
            onClick={undoFlow}
            disabled={!canUndo}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white/58 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            onClick={redoFlow}
            disabled={!canRedo}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white/58 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
          >
            <Redo2 size={15} />
          </button>
          <span className="my-1 h-px w-6 bg-white/[0.07]" />
          <button
            type="button"
            onClick={resetLayout}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white/48 hover:bg-white/[0.05]"
            title="Reset flow layout"
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            onClick={() => router.push("/settings")}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white/48 hover:bg-white/[0.05]"
            title="Settings"
          >
            <Settings size={15} />
          </button>
        </div>

        <div className="absolute bottom-4 left-4 z-40 flex items-center gap-1 rounded-xl border border-white/[0.07] bg-[#18181a]/94 p-1.5 text-white/55 shadow-xl backdrop-blur">
          <button onClick={() => zoomBy(-0.1)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.06]" title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button onClick={fitView} className="min-w-[54px] px-1 text-[13px] hover:text-white" title="Fit view">
            {Math.round(camera.zoom * 100)}%
          </button>
          <button onClick={() => zoomBy(0.1)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.06]" title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <span className="mx-1 h-5 w-px bg-white/[0.07]" />
          <span className="px-2 text-[13px] text-white/42">Page 1</span>
        </div>

        {pendingConnection && (
          <div className="absolute left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[#6d55a5]/40 bg-[#1c1725]/95 px-3 py-2 text-[13px] text-[#cfbcff] shadow-xl backdrop-blur">
            <Link2 size={12} /> Connect to a compatible port, or click empty space to insert the next node
            <button onClick={() => setPendingConnection(null)} className="ml-1 rounded-md p-1 hover:bg-white/[0.06]">
              <X size={12} />
            </button>
          </div>
        )}

        {addMenu && (
          <div
            className="fixed z-[100] w-[265px] overflow-hidden rounded-[13px] border border-white/[0.08] bg-[#202022]/98 shadow-[0_24px_70px_rgba(0,0,0,.45)] backdrop-blur-xl"
            style={{ left: clamp(addMenu.screenX, 88, window.innerWidth - 285), top: clamp(addMenu.screenY, 75, window.innerHeight - 390) }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-11 items-center gap-2 border-b border-white/[0.06] px-3 text-white/35">
              <span className="text-lg leading-none">⌕</span>
              <span className="text-[13px]">Search</span>
            </div>
            <div className="p-1.5">
              {!addMenu.pending && (
                <button onClick={() => addFromMenu("PIPELINE")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-white/82 hover:bg-white/[0.06]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#4f79ff]/15 text-[#86a4ff]"><Link2 size={14} /></span>
                  New AI pipeline
                </button>
              )}

              {(!addMenu.pending || addMenu.pending.outputType === "TEXT") && (
                <>
                  {!addMenu.pending && (
                    <button onClick={() => addFromMenu("TEXT")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-white/82 hover:bg-white/[0.06]">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#8657f2]/14 text-[#ba9cff]"><Type size={14} /></span>
                      Text
                    </button>
                  )}
                  {(!addMenu.pending || nodeById.get(addMenu.pending.fromNodeId)?.kind === "TEXT") && (
                    <button onClick={() => addFromMenu("ASSISTANT")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-white/82 hover:bg-white/[0.06]">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#8657f2]/18 text-[#b899ff]"><Sparkles size={14} /></span>
                      Assistant (ChatGPT)
                    </button>
                  )}
                  {(!addMenu.pending || nodeById.get(addMenu.pending.fromNodeId)?.kind === "ASSISTANT") && (
                    <button onClick={() => addFromMenu("IMAGE_GENERATOR")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-white/82 hover:bg-white/[0.06]">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-400/10 text-emerald-300"><FileImage size={14} /></span>
                      Image Generator (Gemini)
                    </button>
                  )}
                </>
              )}

              {addMenu.pending?.outputType === "IMAGE" && (
                <button onClick={() => addFromMenu("IMAGE_GENERATOR")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-white/82 hover:bg-white/[0.06]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-400/10 text-emerald-300"><FileImage size={14} /></span>
                  Image Generator (use as source)
                </button>
              )}

              {!addMenu.pending && (
                <button onClick={() => addFromMenu("REFERENCE")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-white/82 hover:bg-white/[0.06]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-400/10 text-cyan-300"><ImagePlus size={14} /></span>
                  Upload reference image
                </button>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-white/[0.05] px-3 py-2 text-[13px] text-white/24">
              <span>↑↓ Navigate</span><span>↵ Insert</span>
            </div>
          </div>
        )}

        {(error || toast) && (
          <div className="absolute bottom-5 right-5 z-[90] max-w-[430px]">
            {error && (
              <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-500/20 bg-[#251719]/95 px-4 py-3 text-[13px] leading-5 text-red-200 shadow-xl backdrop-blur">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-auto p-1 text-red-200/50 hover:text-red-100"><X size={12} /></button>
              </div>
            )}
            {toast && (
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#1b1b1d]/95 px-4 py-3 text-[13px] text-white/76 shadow-xl backdrop-blur">
                <Check size={14} className="text-emerald-400" /> {toast}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
