/**
 * README screenshots, end to end, from fake data:
 * seed -> server -> shoot -> frame -> teardown.
 *
 *     npm run screenshots              # everything
 *     npm run screenshots -- --keep    # leave the demo server up afterwards
 *     npm run screenshots -- --only hero,tasks
 *     npm run screenshots -- --only running-turn   # a held running turn
 */
import fs from "fs";
import path from "path";
import { type ChildProcess } from "child_process";
import { spawnServer } from "@/lib/dev-instance";
import { BASE_URL, PORT, REPO, ROOT, demoEnv } from "./config";
import { seed, teardownTmux } from "./seed";
import { shoot } from "./shoot";
import { SHOTS } from "./shots";
import { frame } from "./frame";
import { startPeer } from "./peer";

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

function startServer(demoChat: boolean): ChildProcess {
  const log = fs.openSync(path.join(ROOT, "server.log"), "w");
  // Loopback only: the demo never listens on another network.
  return spawnServer({
    repo: REPO,
    port: PORT,
    // No watchers: the seeded orchestrator and tasks must sit still, never
    // start an agent.
    env: demoEnv({
      AGENTOS_BIND: "127.0.0.1",
      AGENTOS_ORCHESTRATOR: "off",
      AGENTOS_STACKS: "off",
      // Scripted chat turns (lib/chat/drivers/demo-script), for on-demand shots.
      ...(demoChat ? { AGENTOS_DEMO_CHAT: "1" } : {}),
    }),
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

// An on-demand shot has no README frame; its raw captures would go with the
// demo root, so they are copied to .agentos/screenshots (git-ignored there).
function keepOnDemand(raw: Awaited<ReturnType<typeof shoot>>): void {
  const names = new Set(SHOTS.filter((s) => s.onDemand).map((s) => s.name));
  const dir = path.join(process.cwd(), ".agentos", "screenshots");
  for (const shot of raw) {
    if (!names.has(shot.name)) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(path.dirname(dir), ".gitignore"), "*\n");
    for (const file of shot.files) {
      fs.copyFileSync(file, path.join(dir, path.basename(file)));
      console.log(`  .agentos/screenshots/${path.basename(file)}`);
    }
  }
}

async function main() {
  const only = arg("--only")?.split(",");
  const onDemand = !!only?.some(
    (n) => SHOTS.find((s) => s.name === n)?.onDemand
  );
  const reuse = has("--reuse");
  let server: ChildProcess | null = null;
  const peer = reuse ? null : startPeer();
  try {
    if (!reuse) {
      console.log("Seeding demo data");
      await seed(onDemand);
      console.log(`Starting demo server on :${PORT}`);
      server = startServer(onDemand);
      await waitForServer(server);
    }
    console.log("Shooting");
    const raw = await shoot(only);
    keepOnDemand(raw);
    console.log("Framing");
    await frame(raw);
  } finally {
    if (peer && !has("--keep")) peer.close();
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
