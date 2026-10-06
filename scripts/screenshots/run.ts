/**
 * README screenshots, end to end, from fake data:
 * seed -> server -> shoot -> frame -> teardown.
 *
 *     npm run screenshots              # everything
 *     npm run screenshots -- --keep    # leave the demo server up afterwards
 *     npm run screenshots -- --only hero,tasks
 */
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { BASE_URL, PORT, REPO, ROOT, demoEnv } from "./config";
import { seed, teardownTmux } from "./seed";
import { shoot } from "./shoot";
import { frame } from "./frame";

const has = (flag: string) => process.argv.includes(flag);
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function waitForServer(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Demo server exited early");
    try {
      const res = await fetch(`${BASE_URL}/api/sessions`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Demo server did not answer on ${BASE_URL}`);
}

function startServer(): ChildProcess {
  const log = fs.openSync(path.join(ROOT, "server.log"), "w");
  const tsx = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
  // Loopback only: the demo never listens on another network.
  return spawn(process.execPath, [tsx, "server.ts"], {
    cwd: REPO,
    env: demoEnv({ AGENTOS_BIND: "127.0.0.1" }),
    stdio: ["ignore", log, log],
    detached: true,
  });
}

function stopServer(server: ChildProcess): void {
  if (server.pid === undefined || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

async function main() {
  const only = arg("--only")?.split(",");
  const reuse = has("--reuse");
  let server: ChildProcess | null = null;
  try {
    if (!reuse) {
      console.log("Seeding demo data");
      await seed();
      console.log(`Starting demo server on :${PORT}`);
      server = startServer();
      await waitForServer(server);
    }
    console.log("Shooting");
    const raw = await shoot(only);
    console.log("Framing");
    await frame(raw);
  } finally {
    if (server && !has("--keep")) {
      stopServer(server);
      teardownTmux();
      fs.rmSync(ROOT, { recursive: true, force: true });
    } else if (server) {
      server.unref();
      console.log(
        `Demo server left running (pid ${server.pid}) on ${BASE_URL}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
