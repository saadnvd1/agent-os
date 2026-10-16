import fs from "fs";
import os from "os";
import path from "path";
import { pidAlive } from "./processInfo";
import type { InstanceRecord } from "./types";

type Env = Partial<NodeJS.ProcessEnv>;

export const agentOsHome = (env: Env = process.env): string =>
  env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");

const recordPath = (home: string) => path.join(home, "live-server.json");

// The production server: launched by `npm start` (AGENTOS_SERVER=live), or
// any other production-mode launch that isn't a dev, demo or own-database run.
export function isLiveServer(env: Env = process.env): boolean {
  if (env.AGENTOS_SERVER === "live") return true;
  if (env.AGENTOS_SERVER) return false;
  return (
    env.NODE_ENV === "production" &&
    env.AGENTOS_DEV !== "1" &&
    env.AGENTOS_DEMO !== "1" &&
    !env.DB_PATH
  );
}

export function writeLiveRecord(
  rec: InstanceRecord,
  home = agentOsHome()
): void {
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${recordPath(home)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec));
  fs.renameSync(tmp, recordPath(home));
}

export function readLiveRecord(home = agentOsHome()): InstanceRecord | null {
  try {
    const rec = JSON.parse(fs.readFileSync(recordPath(home), "utf8"));
    if (!Number.isInteger(rec?.pid) || !Number.isInteger(rec?.port))
      return null;
    return pidAlive(rec.pid) ? (rec as InstanceRecord) : null;
  } catch {
    return null;
  }
}
