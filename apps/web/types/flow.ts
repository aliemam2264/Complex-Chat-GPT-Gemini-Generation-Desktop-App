import type { PreserveMode } from "./generation";

export type FlowNodeKind = "IMAGE" | "PROMPT" | "GENERATOR";

export type FlowImageNodeData = {
  assetId: string | null;
  filePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  roleLabel: string;
};

export type FlowPromptNodeData = {
  text: string;
};

export type FlowGenerationHistoryItem = {
  generationId: string;
  outputAssetId: string | null;
  prompt: string;
  createdAt: string;
};

export type FlowGeneratorNodeData = {
  preserveMode: PreserveMode;
  preserveEverythingElse: boolean;
  latestGenerationId: string | null;
  outputAssetId: string | null;
  history: FlowGenerationHistoryItem[];
  historyIndex: number;
};

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  title: string;
  x: number;
  y: number;
  data: FlowImageNodeData | FlowPromptNodeData | FlowGeneratorNodeData;
};

export type FlowEdgePort = "image" | "text" | "source" | "reference" | "prompt";

export type FlowEdge = {
  id: string;
  sourceNodeId: string;
  sourcePort: "image" | "text";
  targetNodeId: string;
  targetPort: "source" | "reference" | "prompt";
};

export type FlowGraph = {
  version: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
  updatedAt: string;
};

export function isImageNodeData(data: FlowNode["data"]): data is FlowImageNodeData {
  return "roleLabel" in data;
}

export function isPromptNodeData(data: FlowNode["data"]): data is FlowPromptNodeData {
  return "text" in data;
}

export function isGeneratorNodeData(data: FlowNode["data"]): data is FlowGeneratorNodeData {
  return "preserveMode" in data;
}
