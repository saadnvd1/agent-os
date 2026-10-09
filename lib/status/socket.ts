import type { EventEmitter } from "events";
import { getDb } from "../db";
import { unwatchGit, watchGit } from "../git-poller";
import { demoDirAllowed, demoMode } from "../security/demo";
import { subscribeStatuses, subscribeStream } from "./hub";

// One /ws/status connection. `v=2` asks for the numbered stream and resumes
// from `epoch`/`seq`; without it, the whole map on connect and on every
// change. The browser also says which git folders it shows (watch_git).

export const PING_MS = 25_000;

export function streamParams(params: URLSearchParams): {
  stream: boolean;
  resume?: { epoch: string; seq: number };
} {
  const stream = params.get("v") === "2";
  const epoch = params.get("epoch");
  const raw = params.get("seq");
  const seq = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return epoch && Number.isSafeInteger(seq)
    ? { stream, resume: { epoch, seq } }
    : { stream };
}

// What the browser sends: only watch_git is read.
export function onStatusMessage(watcher: object, raw: Buffer | string): void {
  try {
    const msg = JSON.parse(raw.toString()) as {
      type?: unknown;
      dirs?: unknown;
    };
    if (msg.type !== "watch_git") return;
    // A demo's visitors are strangers: git runs only in the demo's home.
    const dirs =
      demoMode() && Array.isArray(msg.dirs)
        ? msg.dirs.filter((d) => typeof d === "string" && demoDirAllowed(d))
        : msg.dirs;
    watchGit(watcher, dirs);
  } catch {
    // Not a message this server reads.
  }
}

/** Wires a status socket up; returns what to do when it closes. */
export function serveStatusSocket(
  ws: EventEmitter,
  params: URLSearchParams,
  send: (json: string) => boolean | void
): () => void {
  const { stream, resume } = streamParams(params);
  const unsubscribe = stream
    ? subscribeStream(send, resume)
    : subscribeStatuses(send);
  // A numbered client counts silence as a dead socket; this keeps a quiet
  // stream from looking like one.
  const ping = stream
    ? setInterval(() => send(JSON.stringify({ type: "ping" })), PING_MS)
    : null;
  ws.on("message", (raw: Buffer) => onStatusMessage(ws, raw));
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    if (ping) clearInterval(ping);
    unsubscribe();
    unwatchGit(ws);
  };
  ws.on("close", close);
  ws.on("error", close);
  return close;
}

// Where a session works, for refreshing its git panel when a run ends.
export function sessionFolder(sessionId: string): string | null {
  const s = getDb()
    .prepare(
      `SELECT worktree_path, working_directory FROM sessions WHERE id = ?`
    )
    .get(sessionId) as
    | { worktree_path: string | null; working_directory: string }
    | undefined;
  return s ? s.worktree_path || s.working_directory : null;
}
