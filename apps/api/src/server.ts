import path from "node:path";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

import { initializeDatabase, prisma } from "@eskander/database";

import { getStorageRoot } from "./config/storage";

dotenv.config({
  path: process.env.ESKANDER_ENV_PATH ?? path.resolve(process.cwd(), "../../.env"),
});

const requestedPort = Number(process.env.API_PORT ?? 4000);
const HOST = process.env.API_HOST ?? "127.0.0.1";

async function bootstrap() {
  await initializeDatabase();

  const { projectRouter } = await import("./routes/project.routes");
  const { generationRouter } = await import("./routes/generation.routes");
  const { initializeGenerationRuntimeSettings } = await import(
    "./services/generation-runtime-settings"
  );
  const { recoverInterruptedGenerations } = await import(
    "./services/generation-recovery"
  );

  await initializeGenerationRuntimeSettings();
  await recoverInterruptedGenerations();

  const api = express();

  api.disable("x-powered-by");

  const configuredWebOrigin = process.env.WEB_URL ?? "http://127.0.0.1:3000";

  api.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (health checks / local runtime calls) are safe.
        if (!origin) {
          callback(null, true);
          return;
        }

        if (origin === configuredWebOrigin) {
          callback(null, true);
          return;
        }

        // During development Electron may open Next.js through 127.0.0.1 while
        // .env still contains localhost (or the other way around). Treat both
        // loopback hosts as the same trusted local desktop origin.
        if (process.env.NODE_ENV !== "production") {
          try {
            const url = new URL(origin);
            const isLoopback =
              url.hostname === "127.0.0.1" || url.hostname === "localhost";

            if (isLoopback) {
              callback(null, true);
              return;
            }
          } catch {
            // Fall through to the CORS rejection below.
          }
        }

        callback(new Error(`CORS blocked origin: ${origin}`));
      },
      credentials: false,
    }),
  );

  // Apply CORS before static storage too. Flow images are displayed cross-origin
  // from the local Next.js renderer and may also be fetched by browser APIs.
  api.use("/storage", express.static(getStorageRoot(), {
    fallthrough: false,
    immutable: false,
    maxAge: 0,
  }));

  api.use(express.json({ limit: "2mb" }));

  api.get("/health", (_request, response) => {
    response.json({
      success: true,
      app: "Eskander Plus Studio API",
    });
  });

  api.use("/api/projects", projectRouter);
  api.use("/api/generations", generationRouter);

  api.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error("API Error:", error);

      if (error instanceof multer.MulterError) {
        return response.status(422).json({
          success: false,
          message:
            error.code === "LIMIT_FILE_SIZE"
              ? "Image must be smaller than 50 MB."
              : error.message,
        });
      }

      if (error instanceof Error) {
        return response.status(500).json({
          success: false,
          message: error.message,
        });
      }

      return response.status(500).json({
        success: false,
        message: "Something went wrong.",
      });
    },
  );

  const server = api.listen(requestedPort, HOST, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : requestedPort;

    console.log(`Eskander Plus Studio API running on http://${HOST}:${port}`);
    console.log(`ESKANDER_API_READY:${port}`);
  });

  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[API] ${signal} received. Shutting down...`);

    await new Promise<void>((resolve) => {
      server.close(() => resolve());

      setTimeout(resolve, 5_000).unref();
    });

    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start Eskander Plus Studio API:", error);
  process.exit(1);
});
