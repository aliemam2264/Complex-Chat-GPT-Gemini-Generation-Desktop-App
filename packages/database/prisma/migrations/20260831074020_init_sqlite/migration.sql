-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImageSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImageSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageSessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentAssetId" TEXT,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_imageSessionId_fkey" FOREIGN KEY ("imageSessionId") REFERENCES "ImageSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "imageSessionId" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "outputAssetId" TEXT,
    "userInstruction" TEXT NOT NULL,
    "refinedPrompt" TEXT,
    "preserveMode" TEXT NOT NULL DEFAULT 'STRICT',
    "preserveEverythingElse" BOOLEAN NOT NULL DEFAULT true,
    "promptRevision" INTEGER NOT NULL DEFAULT 0,
    "promptProvider" TEXT,
    "imageProvider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progressStage" TEXT,
    "progressMessage" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "cancelRequestedAt" DATETIME,
    "canceledAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GenerationRun_imageSessionId_fkey" FOREIGN KEY ("imageSessionId") REFERENCES "ImageSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GenerationRun_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GenerationRun_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationReferenceImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationRunId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationReferenceImage_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "ImageSession_projectId_idx" ON "ImageSession"("projectId");

-- CreateIndex
CREATE INDEX "Asset_imageSessionId_idx" ON "Asset"("imageSessionId");

-- CreateIndex
CREATE INDEX "Asset_parentAssetId_idx" ON "Asset"("parentAssetId");

-- CreateIndex
CREATE INDEX "Asset_type_idx" ON "Asset"("type");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationRun_outputAssetId_key" ON "GenerationRun"("outputAssetId");

-- CreateIndex
CREATE INDEX "GenerationRun_projectId_idx" ON "GenerationRun"("projectId");

-- CreateIndex
CREATE INDEX "GenerationRun_imageSessionId_idx" ON "GenerationRun"("imageSessionId");

-- CreateIndex
CREATE INDEX "GenerationRun_sourceAssetId_idx" ON "GenerationRun"("sourceAssetId");

-- CreateIndex
CREATE INDEX "GenerationRun_status_idx" ON "GenerationRun"("status");

-- CreateIndex
CREATE INDEX "GenerationReferenceImage_generationRunId_idx" ON "GenerationReferenceImage"("generationRunId");
