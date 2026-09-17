ALTER TABLE "ImageSession" ADD COLUMN "isWorkspace" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImageSession" ADD COLUMN "flowStateJson" TEXT;
ALTER TABLE "GenerationRun" ADD COLUMN "flowNodeId" TEXT;
ALTER TABLE "GenerationRun" ADD COLUMN "keepOutput" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "GenerationRun_flowNodeId_idx" ON "GenerationRun"("flowNodeId");
