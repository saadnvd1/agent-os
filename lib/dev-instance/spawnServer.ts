import path from "path";
import {
  execFileSync,
  spawn,
  type ChildProcess,
  type StdioOptions,
} from "child_process";
import { readLiveRecord } from "./liveServer";
import { assertNotLivePort } from "./pickPort";

// The one way a server process is started outside `npm start`: a single node
// process (no tsx wrapper), never on the live server's port.
export function spawnServer(opts: {
  repo: string;
  port: number;
  env: NodeJS.ProcessEnv;
  stdio: StdioOptions;
  detached?: boolean;
  native?: boolean;
}): ChildProcess {
  const { repo, port, env, stdio, detached, native } = opts;
  assertNotLivePort(port, process.env, readLiveRecord());
  const run = (script: string, ...args: string[]) =>
    execFileSync(
      process.execPath,
      [path.join(repo, "scripts", script), ...args],
      {
        cwd: repo,
        stdio: "ignore",
      }
    );
  if (native) run("check-native.mjs", "--rebuild");
  run("gen-migrations-index.mjs");
  return spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: repo,
    env: { ...env, PORT: String(port), AGENTOS_SERVER: "dev" },
    stdio,
    detached,
  });
}
