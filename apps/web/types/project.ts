export type AssetType = "ORIGINAL" | "GENERATED" | "FLOW_INPUT";

export type Asset = {
  id: string;

  imageSessionId: string;

  type: AssetType;

  parentAssetId: string | null;

  filePath: string;
  fileName: string;
  mimeType: string;

  width: number | null;
  height: number | null;

  createdAt: string;
};

export type ImageSession = {
  id: string;

  projectId: string;

  name: string;

  assets: Asset[];

  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;

  name: string;

  description: string | null;

  createdAt: string;
  updatedAt: string;

  _count?: {
    imageSessions: number;
  };
};

export type ProjectDetails = Project & {
  imageSessions: ImageSession[];
};
