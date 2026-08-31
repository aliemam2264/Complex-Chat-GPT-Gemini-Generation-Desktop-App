import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),

  // Electron loads the dev UI from 127.0.0.1. Next.js blocks dev assets/HMR
  // from alternate origins unless they are explicitly allowed.
  allowedDevOrigins: ["127.0.0.1"],

  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
};

export default nextConfig;
