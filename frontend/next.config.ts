import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  allowedDevOrigins: ["192.168.1.105", "10.207.8.196"],
  poweredByHeader: false,
  turbopack: { root: path.resolve(__dirname, "..") },
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  // Keep CI/cloud builds proportionate to this small application.
  experimental: { cpus: 2 },
};
export default config;
