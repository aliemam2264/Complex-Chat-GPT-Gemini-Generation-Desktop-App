import { prisma } from "./client";

const SCHEMA_VERSION = 1;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS "_EskanderMeta" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "ImageSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImageSession_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageSessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentAssetId" TEXT,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "Asset_imageSessionId_fkey"
      FOREIGN KEY ("imageSessionId") REFERENCES "ImageSession" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_parentAssetId_fkey"
      FOREIGN KEY ("parentAssetId") REFERENCES "Asset" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "GenerationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "imageSessionId" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "outputAssetId" TEXT,
    "userInstruction" TEXT NOT NULL,
    "refinedPrompt" TEXT,
    "preserveMode" TEXT NOT NULL DEFAULT 'STRICT',
    "preserveEverythingElse" INTEGER NOT NULL DEFAULT 1,
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
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationRun_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GenerationRun_imageSessionId_fkey"
      FOREIGN KEY ("imageSessionId") REFERENCES "ImageSession" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GenerationRun_sourceAssetId_fkey"
      FOREIGN KEY ("sourceAssetId") REFERENCES "Asset" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GenerationRun_outputAssetId_fkey"
      FOREIGN KEY ("outputAssetId") REFERENCES "Asset" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "Project_createdAt_idx" ON "Project"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "ImageSession_projectId_idx" ON "ImageSession"("projectId")`,
  `CREATE INDEX IF NOT EXISTS "Asset_imageSessionId_idx" ON "Asset"("imageSessionId")`,
  `CREATE INDEX IF NOT EXISTS "Asset_parentAssetId_idx" ON "Asset"("parentAssetId")`,
  `CREATE INDEX IF NOT EXISTS "Asset_type_idx" ON "Asset"("type")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "GenerationRun_outputAssetId_key" ON "GenerationRun"("outputAssetId")`,
  `CREATE INDEX IF NOT EXISTS "GenerationRun_projectId_idx" ON "GenerationRun"("projectId")`,
  `CREATE INDEX IF NOT EXISTS "GenerationRun_imageSessionId_idx" ON "GenerationRun"("imageSessionId")`,
  `CREATE INDEX IF NOT EXISTS "GenerationRun_sourceAssetId_idx" ON "GenerationRun"("sourceAssetId")`,
  `CREATE INDEX IF NOT EXISTS "GenerationRun_status_idx" ON "GenerationRun"("status")`,
];

export async function initializeDatabase() {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");

  // WAL is a good fit for the desktop app because the UI may read while
  // background generation jobs update progress in the same database.
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");

  for (const statement of schemaStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "_EskanderMeta" ("key", "value") VALUES ('schemaVersion', ?)
     ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
    String(SCHEMA_VERSION),
  );
}
