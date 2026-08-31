-- AlterEnum
ALTER TYPE "GenerationStatus" ADD VALUE 'CANCELED';

-- AlterTable
ALTER TABLE "GenerationRun" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3);
