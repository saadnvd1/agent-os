import type { CallUsage } from "../usage/types";
import type { SearchResult } from "./find";

/**
 * The provider-neutral shape of a chat conversation. Every driver (Claude
 * today, others later) turns its own protocol into these items; storage,
 * streaming and the UI only ever see them.
 */

export interface ChatImage {
  mediaType: string;
  data: string; // base64
}

// A slash command or skill the agent accepts at the start of a message.
export interface ChatCommand {
  name: string;
  description: string;
  argumentHint?: string;
  builtin?: boolean;
}

export interface ChatModel {
  value: string;
  label: string;
  description?: string;
}

export type ToolStatus = "running" | "done" | "error" | "stopped";

export interface FileDiff {
  path: string;
  before: string;
  after: string;
}

// What the agent may do without asking: ask before anything not already
// allowed, accept file edits on its own, or do everything.
export type ChatAccess = "ask" | "edits" | "full";
export const CHAT_ACCESS: ChatAccess[] = ["ask", "edits", "full"];

export interface ChatQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

// The reader's answer to an approval card.
export type ApprovalDecision =
  | { decision: "allow" | "always" | "deny" }
  | { decision: "answer"; answers: Record<string, string> };

export interface PeerMessage {
  sessionId: string;
  body: string;
}

// What sent a message the reader didn't type, set where it's sent so chat
// shows it as an event rather than as theirs. The agent's text is unchanged.
export type ChatOriginKind =
  // AgentOS telling the orchestrator what changed (PRs, CI, reviews, asks).
  | "event"
  // Another agent session, over the bus.
  | "peer"
  // A saved schedule, on its timer.
  | "schedule"
  // AgentOS itself: the load monitor, stacks.
  | "system"
  // The reader's own decision, made outside the composer (a plan carried out).
  | "decision"
  // The reader's phone: a shake report or something shared to AgentOS.
  | "device";

export interface ChatOrigin {
  kind: ChatOriginKind;
  // Who it's from: "AgentOS", a session's or a schedule's name.
  label: string;
  // The session that sent it, to link to.
  sessionId?: string;
  // What chat shows, when not the text the agent got (which carries who
  // it's from and how to reply).
  body?: string;
  // Lines of an event batch that are the reader's answers to asks.
  decided?: string[];
  // The tasks it is about, by name, set where the event is delivered.
  subjects?: { id: string; name: string }[];
  // Only Away mode's own lines: the turn it starts isn't anyone's activity
  // (lib/away/activity).
  away?: true;
}

// Who sent a message, carried with it through the queue and the worker.
export interface SentBy {
  from?: string;
  peer?: PeerMessage;
  origin?: ChatOrigin;
}

export interface McpServerView {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  // Where it's configured: user, project, local, plugin, claudeai…
  scope?: string;
  version?: string;
  error?: string;
  // Needs sign-in and AgentOS can start it (the driver can, and the server
  // speaks OAuth over HTTP). Decided by the server, never by its name.
  signIn?: boolean;
  tools: { name: string; description?: string }[];
}

// What starting an MCP server's sign-in came back with: "callback" (open the
// link; the provider returns to AgentOS), "paste" (the provider only returns
// to the machine running the session: paste the address it ends on),
// "external" (finish on claude.ai) or "done" (signed in without asking).
export interface McpSignInStart {
  mode: "callback" | "paste" | "external" | "done";
  authUrl?: string;
}

// How full the conversation's context window is, as the agent last measured.
export interface ChatContext {
  usedTokens: number;
  maxTokens: number;
  percentage: number;
  categories: { name: string; tokens: number }[];
  model?: string;
  // When it was measured: the end of the last turn.
  at: number;
  // The prompt-cache lifetime the conversation writes with (lib/chat/stale),
  // once a turn has said.
  cacheTtlMs?: number;
}

// Running totals the agent reports at the end of each turn.
export interface UsageTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Base {
  id: string;
  createdAt: number;
}

export type ChatItem =
  | (Base & {
      kind: "user";
      text: string;
      images?: ChatImage[];
      // Who sent it through the agent bus, when not typed here.
      from?: string;
      // Sent by another agent session: shown as its body, while the agent
      // gets the full text with how to reply.
      peer?: PeerMessage;
      origin?: ChatOrigin;
      // Saved since messages were tagged where they're sent: without an
      // origin, the reader typed it. Older items are matched by their text.
      tagged?: true;
      // Whether it was sent while a turn ran: the agent then reads it once
      // that turn ends, so what follows until then is still that turn's.
      // Always set when saved; absent only on history from before it was.
      midTurn?: boolean;
      // The provider's id for this message, to undo file changes back to it.
      checkpoint?: string;
    })
  | (Base & { kind: "assistant"; text: string; streaming?: boolean })
  | (Base & { kind: "reasoning"; text: string; streaming?: boolean })
  | (Base & {
      kind: "tool";
      name: string;
      title: string;
      input: unknown;
      status: ToolStatus;
      output?: string;
      diff?: FileDiff;
      // When it finished, to show how long a step took.
      endedAt?: number;
      // Sent without its output and diff (lib/chat/page), which load when
      // it's opened; these say which of the two it has.
      deferred?: boolean;
      hasOutput?: boolean;
      hasDiff?: boolean;
      // The task this call became when it was moved to the background.
      backgroundTaskId?: string;
    })
  | (Base & {
      kind: "todos";
      todos: {
        text: string;
        status: "pending" | "in_progress" | "completed";
      }[];
    })
  | (Base & {
      kind: "turn_end";
      durationMs?: number;
      costUsd?: number;
      interrupted?: boolean;
    })
  | (Base & { kind: "command_output"; text: string })
  // The conversation's MCP servers, as /mcp reports them.
  | (Base & { kind: "mcp"; servers: McpServerView[] })
  | (Base & {
      kind: "compacted";
      trigger?: "manual" | "auto";
      // Context tokens before and after, when the agent reports them.
      before?: number;
      after?: number;
      // Compacted ahead of a message to a stale chat (lib/chat/stale): how
      // long it had been idle.
      idleMs?: number;
    })
  // A plan the agent proposed from plan mode, and whether it was carried out.
  | (Base & { kind: "plan"; plan: string; carried?: boolean })
  | (Base & { kind: "error"; message: string })
  // A page the agent showed with html_render, served sandboxed.
  | (Base & {
      kind: "artifact";
      artifactId: string;
      title: string;
      // A cap on the frame's height; it fits the page otherwise.
      height?: number;
    })
  // A line in an orchestrator's decision log, shown in its chat: a note it
  // wrote, a brake that stopped new starts, something Saad must decide, his
  // answer to an ask, or a pause.
  | (Base & {
      kind: "note";
      text: string;
      tone: "note" | "brake" | "escalation" | "ask" | "pause" | "away";
    })
  | (Base & {
      kind: "approval";
      toolName: string;
      title: string;
      input: unknown;
      diff?: FileDiff;
      // Present when the agent is asking the reader questions, not for access.
      questions?: ChatQuestion[];
      // Whether "always allow" is on offer.
      canAlways: boolean;
      status: "pending" | "allowed" | "denied" | "answered" | "expired";
      // Allowed by No approvals mode, not by the reader.
      auto?: boolean;
    })
  | (Base & {
      // Work the agent runs alongside the turn: a background shell, a
      // subagent, a monitor. Shown in the composer, not the timeline.
      kind: "task";
      taskId: string;
      toolUseId?: string;
      description: string;
      taskType?: string;
      subagentType?: string;
      status: "running" | "completed" | "failed" | "stopped";
      // False while it still blocks the tool call that started it; unset
      // means it runs in the background.
      backgrounded?: boolean;
      endedAt?: number;
      summary?: string;
      outputFile?: string;
      toolUses?: number;
      lastToolName?: string;
      // Housekeeping the agent runs on its own: listed, never counted.
      ambient?: boolean;
    })
  | (Base & {
      kind: "undo";
      // The user message it went back to; it and everything after are undone.
      from: string;
      filesChanged: number;
      insertions?: number;
      deletions?: number;
    });

// A message waiting for the running turn to end.
export interface QueuedMessage {
  id: string;
  text: string;
  imageCount?: number;
  createdAt: number;
}

// A file or folder the agent would match for an @mention.
export interface FileSuggestion {
  path: string;
  dir: boolean;
  // An orchestrator's picker searches several folders: `path` is then
  // absolute, `source` names the folder it came from ("HQ", a project) and
  // `rel` is the path inside it.
  source?: string;
  rel?: string;
}

// Waiting: a turn is paused on the reader (an approval or a question).
export type ChatState = "idle" | "running" | "waiting" | "error";

// A compaction in progress, alongside a "running" state: when it began and
// the context size going in, when known.
export interface Compacting {
  since: number;
  before?: number;
}

export interface UndoPreview {
  canUndo: boolean;
  error?: string;
  files: string[];
  insertions?: number;
  deletions?: number;
}

// What a driver emits while a conversation runs.
export type DriverEvent =
  | { type: "item"; item: ChatItem } // new or replaced item
  | { type: "delta"; id: string; text: string } // streamed text appended to an item
  | { type: "resume_id"; id: string } // the provider's own conversation id
  | { type: "commands"; commands: ChatCommand[] } // the command list changed
  | { type: "terminal_only"; names: string[] } // commands only a terminal can run
  | { type: "suggestion"; text: string } // the agent's guess at the next message
  | { type: "usage"; totals: UsageTotals } // running totals after a turn
  | { type: "usage_start"; totals: UsageTotals } // the totals it started from
  | { type: "call_usage"; call: CallUsage } // one response's tokens
  | { type: "rate_limit"; info: unknown } // the CLI's limit reading
  | { type: "context"; context: ChatContext } // context window use
  | { type: "turn_start" } // the agent started a turn (maybe one nobody sent)
  | { type: "at_rest" } // it has run every message it was given
  | { type: "state"; state: ChatState }
  // The agent started (true) or finished (false) compacting its context.
  | { type: "compacting"; active: boolean };

// A tool call's output and diff, loaded when it's opened.
export interface ToolBody {
  output?: string;
  diff?: FileDiff;
}

// What the server sends to a browser watching a conversation.
export type ChatServerMessage =
  | {
      type: "snapshot";
      // The latest page; older ones come with `history`.
      items: ChatItem[];
      // Where older items start, and whether there are any.
      cursor: number | null;
      hasMore: boolean;
      // Background tasks from before the page, for the composer's list.
      tasks: ChatItem[];
      state: ChatState;
      compacting?: Compacting | null;
      queue: QueuedMessage[];
      suggestion: string | null;
    }
  | {
      type: "history";
      before: number;
      items: ChatItem[];
      cursor: number | null;
      hasMore: boolean;
    }
  | { type: "tool_body"; id: string; body: ToolBody | null }
  // Find in the conversation: one page of results for the request `reqId`.
  | ({ type: "search"; reqId: string; query: string } & SearchResult)
  | { type: "queue"; queue: QueuedMessage[] }
  | { type: "suggestion"; text: string | null }
  | {
      type: "files";
      reqId: string;
      query: string;
      files: FileSuggestion[];
    }
  | { type: "item"; item: ChatItem }
  | { type: "delta"; id: string; text: string }
  | { type: "state"; state: ChatState }
  | { type: "compacting"; compacting: Compacting | null }
  | {
      type: "capabilities";
      commands: ChatCommand[];
      models: ChatModel[];
      model: string;
      // A readable name for `model` when it is not one of `models`.
      modelLabel?: string;
      access: ChatAccess;
      // Plan mode: on, or null when the session can't use it.
      plan: boolean | null;
      // Whether a blocking call can be moved to the background.
      background?: boolean;
    }
  | { type: "context"; context: ChatContext | null }
  | { type: "undo_preview"; from: string; preview: UndoPreview }
  | {
      type: "task_output";
      taskId: string;
      text: string | null;
      updatedAt: number | null;
    }
  | {
      type: "background_result";
      toolUseId?: string;
      ok: boolean;
      error?: string;
    }
  | { type: "undone"; from: string; text: string }
  // A send with a `clientId` was taken in (before any worker is up), or
  // failed. The message itself still comes as an item or in the queue.
  | { type: "accepted"; id: string }
  | { type: "send_failed"; id: string; message: string };

// What a browser sends.
export type ChatClientMessage =
  // `clientId` (`user-c-…`) becomes the message's id: a resend is a no-op.
  | { type: "send"; text: string; images?: ChatImage[]; clientId?: string }
  | { type: "queue_edit"; id: string; text: string }
  | { type: "queue_move"; id: string; by: -1 | 1 }
  | { type: "queue_delete"; id: string }
  // `during`: the user message whose turn was running when it was tapped.
  | { type: "queue_send_now"; id: string; during?: string }
  | { type: "files"; reqId: string; query: string }
  | { type: "interrupt"; hard?: boolean }
  | { type: "set_model"; model: string }
  | { type: "set_access"; access: ChatAccess }
  | { type: "set_plan"; plan: boolean }
  // Loads the "/" commands again, skipping the cache.
  | { type: "refresh_commands" }
  // Leaves plan mode and asks the agent to carry out that plan.
  | { type: "carry_plan"; id: string }
  | ({ type: "respond"; id: string } & ApprovalDecision)
  | { type: "undo"; from: string; dryRun?: boolean }
  | { type: "stop_task"; taskId: string }
  | { type: "background_task"; toolUseId?: string }
  | { type: "task_output"; taskId: string }
  // Older items, from before a page's cursor.
  | { type: "history"; before: number }
  | { type: "tool_body"; id: string }
  // Older results from before `before`, a cursor from an earlier page.
  | { type: "search"; reqId: string; query: string; before?: number };
