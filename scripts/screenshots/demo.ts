/**
 * The demo, served: seeds the fake world (seed.ts), then runs the server
 * over it in demo mode (AGENTOS_DEMO=1, lib/security/demo).
 *
 *     npm run demo                 # development server on :3340
 *     npm run build && npm run demo -- --prod
 *     AGENTOS_BIND=0.0.0.0 AGENTOS_ALLOWED_HOSTS=demo.example.com npm run demo -- --prod
 *
 * Pairing still applies; AGENTOS_AUTH=off makes it open to anyone, which is
 * what demo mode is for.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { PORT, REPO, demoEnv } from "./config";
import { seed, teardownTmux } from "./seed";
import { startPeer } from "./peer";

const PASSED_THROUGH = [
  "AGENTOS_BIND",
  "AGENTOS_ALLOWED_HOSTS",
  "AGENTOS_AUTH",
] as const;

async function main() {
  const prod = process.argv.includes("--prod");
  if (prod && !fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) {
    throw new Error("No production build: run `npm run build` first");
  }
  console.log("Seeding demo data");
  await seed();
  const peer = startPeer();
  const passed = Object.fromEntries(
    PASSED_THROUGH.flatMap((k) =>
      process.env[k] ? [[k, process.env[k]!]] : []
    )
  );
  const tsx = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
  const server = spawn(process.execPath, [tsx, "server.ts"], {
    cwd: REPO,
    env: demoEnv({
      AGENTOS_BIND: "127.0.0.1",
      ...passed,
      AGENTOS_DEMO: "1",
      NODE_ENV: prod ? "production" : "development",
    }),
    stdio: "inherit",
  });
  console.log(`Demo server starting on :${PORT}`);
  const stop = () => server.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code) => {
    peer.close();
    teardownTmux();
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
