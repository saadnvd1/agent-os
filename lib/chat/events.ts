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

export interface McpServerView {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  // Where it's configured: user, project, local, plugin, claudeai…
  scope?: string;
  version?: string;
  error?: string;
  tools: { name: string; description?: string }[];
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
  | (Base & { kind: "compacted"; trigger?: "manual" | "auto" })
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
      tone: "note" | "brake" | "escalation" | "ask" | "pause";
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
}

// Waiting: a turn is paused on the reader (an approval or a question).
export type ChatState = "idle" | "running" | "waiting" | "error";

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
  | { type: "state"; state: ChatState };

// What the server sends to a browser watching a conversation.
export type ChatServerMessage =
  | {
      type: "snapshot";
      items: ChatItem[];
      state: ChatState;
      queue: QueuedMessage[];
      suggestion: string | null;
    }
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
  | {
      type: "capabilities";
      commands: ChatCommand[];
      models: ChatModel[];
      model: string;
      access: ChatAccess;
    }
  | { type: "undo_preview"; from: string; preview: UndoPreview }
  | { type: "task_output"; taskId: string; text: string | null }
  | { type: "undone"; from: string; text: string };

// What a browser sends.
export type ChatClientMessage =
  | { type: "send"; text: string; images?: ChatImage[] }
  | { type: "queue_edit"; id: string; text: string }
  | { type: "queue_move"; id: string; by: -1 | 1 }
  | { type: "queue_delete"; id: string }
  // `during`: the user message whose turn was running when it was tapped.
  | { type: "queue_send_now"; id: string; during?: string }
  | { type: "files"; reqId: string; query: string }
  | { type: "interrupt" }
  | { type: "set_model"; model: string }
  | { type: "set_access"; access: ChatAccess }
  | ({ type: "respond"; id: string } & ApprovalDecision)
  | { type: "undo"; from: string; dryRun?: boolean }
  | { type: "stop_task"; taskId: string }
  | { type: "task_output"; taskId: string };
