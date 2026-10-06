/**
 * What the AgentOS server and a chat worker say to each other over the
 * worker's Unix socket: one JSON message per line.
 */

import crypto from "crypto";
import os from "os";
import path from "path";
import type {
  ApprovalDecision,
  ChatAccess,
  ChatImage,
  ChatItem,
  ChatState,
  DriverEvent,
} from "../events";
import type { UndoResult } from "../driver";

export const PROTOCOL_VERSION = 1;

// Server -> worker. A send carries the id its user item gets, so a send
// retried after a dropped connection is never run twice.
export type WorkerCommand =
  | {
      type: "send";
      id: string;
      text: string;
      images?: ChatImage[];
      from?: string;
    }
  | { type: "interrupt" }
  | { type: "set_model"; model: string }
  | { type: "set_access"; access: ChatAccess }
  | ({ type: "respond"; id: string } & ApprovalDecision)
  | { type: "undo"; reqId: string; checkpoint: string; dryRun: boolean }
  | { type: "stop_task"; taskId: string }
  | { type: "close" };

// Worker -> server: what's live right now on connecting, then events.
export type WorkerEvent =
  | {
      type: "hello";
      version: number;
      state: ChatState;
      streaming: ChatItem[];
    }
  | Exclude<DriverEvent, { type: "resume_id" }>
  | { type: "undo_result"; reqId: string; result?: UndoResult; error?: string };

// Per database, so a test server's workers never meet the live server's.
export function workerDir(): string {
  const db = path.resolve(
    process.env.DB_PATH || path.join(process.cwd(), "agent-os.db")
  );
  const key = crypto.createHash("sha1").update(db).digest("hex").slice(0, 8);
  return path.join(os.homedir(), ".agent-os", "chat", key);
}

export const socketPath = (sessionId: string) =>
  path.join(workerDir(), `${sessionId}.sock`);

export const envPath = (sessionId: string) =>
  path.join(workerDir(), `${sessionId}.env.json`);

export const WORKER_TMUX_PREFIX = "aos-chat-";
export const workerTmuxName = (sessionId: string) =>
  `${WORKER_TMUX_PREFIX}${sessionId}`;

// Newline-delimited JSON off a stream.
export function lineReader(onMessage: (m: unknown) => void) {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (error) {
        console.error("Bad chat worker message:", error);
      }
    }
  };
}
