import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";

const configuredConnectionString = process.env.DATABASE_URL;

const connectionString =
  configuredConnectionString?.startsWith("file:")
    ? configuredConnectionString
    : "file:./eskander.sqlite";

if (
  configuredConnectionString &&
  !configuredConnectionString.startsWith("file:") &&
  process.env.NODE_ENV !== "production"
) {
  console.warn(
    "[Database] Ignoring non-SQLite DATABASE_URL in desktop mode and using file:./eskander.sqlite.",
  );
}

const adapter = new PrismaBetterSqlite3(
  {
    url: connectionString,
  },
  {
    timestampFormat: "iso8601",
  },
);

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
