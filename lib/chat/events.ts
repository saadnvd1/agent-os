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

interface Base {
  id: string;
  createdAt: number;
}

export type ChatItem =
  | (Base & { kind: "user"; text: string; images?: ChatImage[]; from?: string })
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
  | (Base & { kind: "compacted"; trigger?: "manual" | "auto" })
  | (Base & { kind: "error"; message: string });

export type ChatState = "idle" | "running" | "error";

// What a driver emits while a conversation runs.
export type DriverEvent =
  | { type: "item"; item: ChatItem } // new or replaced item
  | { type: "delta"; id: string; text: string } // streamed text appended to an item
  | { type: "resume_id"; id: string } // the provider's own conversation id
  | { type: "commands"; commands: ChatCommand[] } // the command list changed
  | { type: "terminal_only"; names: string[] } // commands only a terminal can run
  | { type: "state"; state: ChatState };

// What the server sends to a browser watching a conversation.
export type ChatServerMessage =
  | { type: "snapshot"; items: ChatItem[]; state: ChatState }
  | { type: "item"; item: ChatItem }
  | { type: "delta"; id: string; text: string }
  | { type: "state"; state: ChatState }
  | {
      type: "capabilities";
      commands: ChatCommand[];
      models: ChatModel[];
      model: string;
    };

// What a browser sends.
export type ChatClientMessage =
  | { type: "send"; text: string; images?: ChatImage[] }
  | { type: "interrupt" }
  | { type: "set_model"; model: string };
