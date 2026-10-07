import type { NextConfig } from "next";
import { resolve } from "path";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // scripts/redeploy builds into a side directory and swaps it into .next,
  // so the live server never serves a half-written build.
  distDir: process.env.AGENTOS_DIST_DIR || ".next",
  devIndicators: false,
  turbopack: {
    root: resolve(import.meta.dirname),
  },
};

export default withSerwist(nextConfig);
