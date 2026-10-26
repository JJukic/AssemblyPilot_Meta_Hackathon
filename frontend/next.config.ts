import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: path.resolve(__dirname, "..") },
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  // Keep CI/cloud builds proportionate to this small application.
  experimental: { cpus: 2 },
};
export default config;
