/**
 * The server's side of a chat worker: starts one in tmux when none is
 * running, connects to its socket, and passes commands and events along.
 */

import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import net from "net";
import path from "path";
import { promisify } from "util";
import type { UndoResult } from "../driver";
import {
  envPath,
  lineReader,
  PROTOCOL_VERSION,
  socketPath,
  workerDir,
  workerTmuxName,
  type WorkerCommand,
  type WorkerEvent,
} from "./protocol";

const execFileAsync = promisify(execFile);
const START_TIMEOUT_MS = 20_000;

export interface WorkerHandlers {
  onEvent: (e: WorkerEvent) => void;
  // The worker went away: it exited, or its socket dropped.
  onClose: () => void;
}

export class WorkerClient {
  private undos = new Map<
    string,
    { resolve: (r: UndoResult) => void; reject: (e: Error) => void }
  >();

  private constructor(
    private socket: net.Socket,
    private handlers: WorkerHandlers
  ) {
    socket.on(
      "data",
      lineReader((m) => this.receive(m as WorkerEvent))
    );
    socket.on("close", () => {
      for (const u of this.undos.values())
        u.reject(new Error("The chat worker went away"));
      this.undos.clear();
      handlers.onClose();
    });
    socket.on("error", () => socket.destroy());
  }

  // Resolves on the worker's hello, so the caller starts from its state.
  static connect(
    sessionId: string,
    handlers: WorkerHandlers
  ): Promise<{ client: WorkerClient; hello: HelloEvent }> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(socketPath(sessionId));
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      };
      socket.once("error", fail);
      const read = lineReader((m) => {
        if (settled) return;
        const e = m as WorkerEvent;
        if (e.type !== "hello") return fail(new Error("No hello from worker"));
        if (e.version !== PROTOCOL_VERSION)
          console.warn(
            `Chat worker ${sessionId} speaks protocol ${e.version}, this server ${PROTOCOL_VERSION}`
          );
        settled = true;
        socket.off("data", read);
        socket.off("error", fail);
        resolve({ client: new WorkerClient(socket, handlers), hello: e });
      });
      socket.on("data", read);
      setTimeout(() => fail(new Error("Chat worker didn't answer")), 5000);
    });
  }

  private receive(e: WorkerEvent): void {
    if (e.type === "undo_result") {
      const u = this.undos.get(e.reqId);
      this.undos.delete(e.reqId);
      if (e.result) u?.resolve(e.result);
      else u?.reject(new Error(e.error ?? "Undo failed"));
      return;
    }
    this.handlers.onEvent(e);
  }

  command(cmd: WorkerCommand): void {
    this.socket.write(`${JSON.stringify(cmd)}\n`);
  }

  undo(checkpoint: string, dryRun: boolean): Promise<UndoResult> {
    const reqId = randomUUID();
    return new Promise((resolve, reject) => {
      this.undos.set(reqId, { resolve, reject });
      this.command({ type: "undo", reqId, checkpoint, dryRun });
    });
  }

  // Drops the connection; the worker keeps running.
  detach(): void {
    this.socket.destroy();
  }
}

type HelloEvent = Extract<WorkerEvent, { type: "hello" }>;

// A socket file left behind by a worker that died.
function removeStaleSocket(sessionId: string): void {
  const sock = socketPath(sessionId);
  try {
    if (fs.lstatSync(sock).isSocket()) fs.rmSync(sock);
  } catch {
    // Not there.
  }
}

async function tmuxHas(name: string): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["has-session", "-t", `=${name}`]);
    return true;
  } catch {
    return false;
  }
}

// A worker that stopped listening is exiting; give it a moment, then end it.
async function waitForExit(sessionId: string): Promise<void> {
  const name = workerTmuxName(sessionId);
  const deadline = Date.now() + 5000;
  while (await tmuxHas(name)) {
    if (Date.now() > deadline) {
      await execFileAsync("tmux", ["kill-session", "-t", `=${name}`]).catch(
        () => {}
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

// Starts a worker in its own tmux session. The server's environment goes in
// a private file the worker reads and deletes, not on the command line.
async function spawnWorker(sessionId: string): Promise<void> {
  const name = workerTmuxName(sessionId);
  if (await tmuxHas(name)) return;
  fs.mkdirSync(workerDir(), { recursive: true, mode: 0o700 });
  const env: Record<string, string | undefined> = {
    ...process.env,
    DB_PATH: path.resolve(
      process.env.DB_PATH || path.join(process.cwd(), "agent-os.db")
    ),
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  fs.writeFileSync(envPath(sessionId), JSON.stringify(env), { mode: 0o600 });
  const entry = path.join(process.cwd(), "lib/chat/worker/main.ts");
  await execFileAsync("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    process.cwd(),
    // The worker finds its env file by DB_PATH, so it can't come from there.
    "-e",
    `DB_PATH=${env.DB_PATH}`,
    `exec ${shellQuote(process.execPath)} --import tsx ${shellQuote(entry)} ${shellQuote(sessionId)} > ${shellQuote(path.join(workerDir(), `${sessionId}.log`))} 2>&1`,
  ]);
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Connects to the session's worker, starting one if none is running.
export async function connectWorker(
  sessionId: string,
  spawn: boolean,
  handlers: WorkerHandlers
): Promise<{ client: WorkerClient; hello: HelloEvent }> {
  try {
    return await WorkerClient.connect(sessionId, handlers);
  } catch (error) {
    if (!spawn) throw error;
    // Not running, or on its way out (its socket is already gone).
    await waitForExit(sessionId);
    removeStaleSocket(sessionId);
  }
  await spawnWorker(sessionId);
  const deadline = Date.now() + START_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      return await WorkerClient.connect(sessionId, handlers);
    } catch (error) {
      last = error;
    }
  }
  throw new Error(
    `The chat worker didn't start: ${last instanceof Error ? last.message : String(last)}`
  );
}

// Every session with a worker running now, to reattach after a restart.
export function runningWorkers(): string[] {
  try {
    return fs
      .readdirSync(workerDir())
      .filter((f) => f.endsWith(".sock"))
      .map((f) => f.slice(0, -".sock".length));
  } catch {
    return [];
  }
}
