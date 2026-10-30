/**
 * What the AgentOS server and a chat worker say to each other over the
 * worker's Unix socket: one JSON message per line.
 */

import { agentosHome } from "../../agentos-home";
import crypto from "crypto";
import path from "path";
import type {
  ApprovalDecision,
  ChatAccess,
  ChatFile,
  ChatImage,
  ChatItem,
  ChatState,
  Compacting,
  DriverEvent,
  FileSuggestion,
  McpSignInStart,
  ChatOrigin,
  PeerMessage,
} from "../events";
import type { UndoResult } from "../driver";
import type { CompactFirst } from "../stale";

export const PROTOCOL_VERSION = 1;

// In a worker's hello caps: it holds a live guest's turns to the host's taps
// (./guest-gate). Without it no Drive prompt is sent to it.
export const GUEST_GATE_CAP = "guest-gate";

// Server -> worker. A send carries the id its user item gets, so a send
// retried after a dropped connection is never run twice.
export type WorkerCommand =
  | {
      type: "send";
      id: string;
      text: string;
      images?: ChatImage[];
      files?: ChatFile[];
      from?: string;
      peer?: PeerMessage;
      origin?: ChatOrigin;
      // From the composer: waits its turn behind a running one, in the
      // queue, rather than joining it.
      queue?: boolean;
      // Compact a stale conversation before this goes in (lib/chat/stale).
      compact?: CompactFirst;
    }
  // A queued message goes next: the running turn stops for it.
  // `during`: the user message whose turn the reader saw running; only that
  // turn is stopped for it.
  | { type: "send_now"; id: string; during?: string }
  // Send the queue if no turn is running; a running one sends it as it ends.
  | { type: "drain" }
  | { type: "files"; reqId: string; query: string }
  // hard: a stop that must end the turn (and the agent's wind-down after it).
  | { type: "interrupt"; hard?: boolean }
  | { type: "set_model"; model: string }
  | { type: "set_access"; access: ChatAccess }
  | { type: "set_plan"; plan: boolean }
  | ({ type: "respond"; id: string } & ApprovalDecision)
  | { type: "undo"; reqId: string; checkpoint: string; dryRun: boolean }
  | { type: "stop_task"; taskId: string }
  | { type: "background_task"; reqId: string; toolUseId?: string }
  // Sign in to an MCP server listed in the /mcp item `itemId`: start it
  // (redirectUri: where the provider should return the browser), finish it
  // with the address it returned to (url), or just reconnect.
  | {
      type: "mcp_auth";
      reqId: string;
      action: "start" | "submit" | "reconnect";
      server: string;
      itemId: string;
      redirectUri?: string;
      url?: string;
    }
  // It runs an older build: it takes no new message into its agent (they
  // wait in the queue) and closes at its next turn boundary, so a current
  // worker resumes the conversation with today's tools.
  | { type: "retire" }
  // The reader asked for a fresh conversation: at the next turn boundary
  // (now, if idle) the agent's conversation ends and the next worker
  // starts a new one with today's brief and permissions.
  | { type: "fresh" }
  // A live share's Drive is over (downgrade, take-back, kick, end): its
  // queued prompts go, a turn it steers stops, and nothing more from it is
  // taken in (lib/chat/worker/guest-gate).
  | { type: "guest_release"; share: string; wheel: string }
  // The driving guest's Stop: ends a turn their wheel steers, never another.
  | { type: "guest_stop"; share: string; wheel: string }
  | { type: "close" };

// Worker -> server: what's live right now on connecting, then events.
export type WorkerEvent =
  | {
      type: "hello";
      version: number;
      // The build of the server that started it (lib/build).
      build?: string;
      state: ChatState;
      // A compaction under way (an older worker never says: not compacting).
      compacting?: Compacting | null;
      streaming: ChatItem[];
      // Commands it understands beyond the first protocol ("plan"), so the
      // server never trusts a worker from an older build with one it drops.
      caps?: string[];
    }
  | Exclude<
      DriverEvent,
      {
        type:
          | "resume_id"
          | "usage"
          | "usage_start"
          | "call_usage"
          | "rate_limit"
          | "suggestion"
          | "at_rest"
          | "compacting";
      }
    >
  // Compacting began (with when, and the size going in) or ended (null).
  | { type: "compacting"; compacting: Compacting | null }
  // The agent's guess at the next message, or null once it's stale.
  | { type: "suggestion"; text: string | null }
  | { type: "undo_result"; reqId: string; result?: UndoResult; error?: string }
  | { type: "background_result"; reqId: string; ok?: boolean; error?: string }
  | {
      type: "mcp_auth_result";
      reqId: string;
      start?: McpSignInStart & { state?: string };
      error?: string;
    }
  | {
      type: "files_result";
      reqId: string;
      files?: FileSuggestion[];
      error?: string;
    }
  // The queue in SQLite changed: re-read it.
  | { type: "queue" };

// Per database, so a test server's workers never meet the live server's.
export function workerDir(): string {
  const db = path.resolve(
    process.env.DB_PATH || path.join(process.cwd(), "agent-os.db")
  );
  const key = crypto.createHash("sha1").update(db).digest("hex").slice(0, 8);
  return agentosHome("chat", key);
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
