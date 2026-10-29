import type { NextConfig } from "next";
import { resolve } from "path";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // scripts/redeploy builds into a side directory and swaps it into .next,
  // so the live server never serves a half-written build.
  distDir: process.env.AGENTOS_DIST_DIR || ".next",
  devIndicators: false,
  // Next 16.4 stops `next dev` once under an agent to print an upgrade
  // nudge, which kills every task's dev server. Upgrades go through
  // Dependabot and tasks instead.
  experimental: {
    agentUpgrade: false,
  },
  // A session's readable address (lib/session-url) is the same one page.
  async rewrites() {
    return { beforeFiles: [{ source: "/s/:ref", destination: "/" }] };
  },
  turbopack: {
    root: resolve(import.meta.dirname),
  },
};

export default withSerwist(nextConfig);
