import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
      "src-tauri/**",
      ".claude/**",
    ],
    setupFiles: ["./vitest.setup.ts"],
    // Sessions started by AgentOS inherit NODE_ENV=production, which loads
    // React's production build (no act()); tests always run as tests.
    env: { NODE_ENV: "test" },
    // One database file per worker: the db module opens it at import time.
    pool: "forks",
    // Several suites run real git many times per test; on a Mac busy with
    // other agents the 5s default times them out.
    testTimeout: 30000,
  },
});
