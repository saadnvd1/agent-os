import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The git-heavy suites spike a busy Mac's load, so locally the workers are
// capped; CI keeps vitest's default. AGENTOS_TEST_WORKERS overrides.
const maxWorkers = process.env.AGENTOS_TEST_WORKERS
  ? Number(process.env.AGENTOS_TEST_WORKERS)
  : process.env.CI
    ? undefined
    : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      ".next/**",
      ".next-build/**",
      ".next-prev/**",
      ".deps/**",
      "src-tauri/**",
      ".claude/**",
    ],
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Sessions started by AgentOS inherit NODE_ENV=production, which loads
    // React's production build (no act()); tests always run as tests.
    env: { NODE_ENV: "test" },
    // One database file per worker: the db module opens it at import time.
    pool: "forks",
    maxWorkers,
    // Several suites run real git many times per test; on a Mac busy with
    // other agents the 5s default times them out.
    testTimeout: 30000,
  },
});
