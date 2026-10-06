// Which build of AgentOS this process runs: the server's git commit (or
// version), handed to the chat workers it starts through the environment.
// A worker whose build isn't the server's is running code from before a
// redeploy.

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type { ChatState } from "./chat/events";

export function buildId(): string {
  if (process.env.AGENTOS_BUILD) return process.env.AGENTOS_BUILD;
  let id = "";
  try {
    id = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {}
  if (!id) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
      ) as { version?: string };
      id = `v${pkg.version ?? "unknown"}`;
    } catch {
      id = "unknown";
    }
  }
  process.env.AGENTOS_BUILD = id;
  return id;
}

// An idle worker on another build is closed, so the next message starts
// one on current code. A running turn is never cut.
export const isStaleWorker = (
  workerBuild: string | undefined,
  serverBuild: string,
  state: ChatState
) => state === "idle" && workerBuild !== serverBuild;
