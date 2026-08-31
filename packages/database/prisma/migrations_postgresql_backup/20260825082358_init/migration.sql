-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('ORIGINAL', 'GENERATED');

-- CreateEnum
CREATE TYPE "PreserveMode" AS ENUM ('STRICT', 'BALANCED', 'CREATIVE');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'PROMPTING', 'PROMPT_READY', 'GENERATING', 'DOWNLOADING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('CHATGPT_BROWSER', 'GEMINI_BROWSER', 'OPENAI_API', 'GEMINI_API');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "imageSessionId" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "parentAssetId" TEXT,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "imageSessionId" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "outputAssetId" TEXT,
    "userInstruction" TEXT NOT NULL,
    "refinedPrompt" TEXT,
    "preserveMode" "PreserveMode" NOT NULL DEFAULT 'STRICT',
    "promptProvider" "ProviderType",
    "imageProvider" "ProviderType",
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "ImageSession" ADD CONSTRAINT "ImageSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_imageSessionId_fkey" FOREIGN KEY ("imageSessionId") REFERENCES "ImageSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_imageSessionId_fkey" FOREIGN KEY ("imageSessionId") REFERENCES "ImageSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
