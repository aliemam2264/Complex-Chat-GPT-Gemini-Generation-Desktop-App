-- AlterEnum
ALTER TYPE "ProviderType" ADD VALUE 'LOCAL';

-- AlterTable
ALTER TABLE "GenerationRun" ADD COLUMN     "preserveEverythingElse" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "promptRevision" INTEGER NOT NULL DEFAULT 0;
