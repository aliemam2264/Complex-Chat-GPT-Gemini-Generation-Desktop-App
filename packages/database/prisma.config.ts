import "dotenv/config";

import path from "node:path";
import { defineConfig } from "prisma/config";

const configuredUrl = process.env.DATABASE_URL;
const sqliteUrl = configuredUrl?.startsWith("file:") ? configuredUrl : "file:./dev.sqlite";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),

  migrations: {
    path: path.join("prisma", "migrations"),
  },

  datasource: {
    url: sqliteUrl,
  },
});
