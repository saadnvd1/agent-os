import type {
  McpServerConfig,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ApprovalDecision,
  ChatAccess,
  ChatCommand,
  ChatImage,
  ChatItem,
  ChatModel,
  DriverEvent,
  FileSuggestion,
  UndoPreview,
} from "./events";

export interface ChatStartOptions {
  cwd: string;
  model: string;
  // The provider's id for an existing conversation, to continue it.
  resumeId?: string | null;
  // Continue the conversation only up to this entry (after an undo).
  resumeAt?: string | null;
  access: ChatAccess;
  // Start in plan mode: the agent reads and plans, and changes nothing.
  plan?: boolean;
  // Extra instructions appended to the provider's own system prompt.
  systemAppend?: string;
  env: Record<string, string>;
  // Tools served in-process for this conversation, and tools it may use
  // without asking.
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools?: string[];
  disallowedTools?: string[];
  // A fixed permission mode in place of the access setting, which then
  // can't be changed for this conversation.
  permissionMode?: PermissionMode;
}

// One live conversation with an agent. Messages sent while a turn runs are
// queued by the provider and folded into the conversation.
export interface UndoResult extends UndoPreview {
  // Where the conversation continues from: the entry before the message,
  // null to start over, undefined when only files could be put back.
  resumeAt?: string | null;
}

export interface ChatConversation {
  // Returns the provider's id for the message, to undo back to it.
  // `now`: the running turn stops for it, and it's the very next thing the
  // agent reads, ahead of anything the agent queued itself (a background
  // task's notice). That turn still ends on its own, before this one.
  send(
    text: string,
    images?: ChatImage[],
    options?: { now?: boolean }
  ): string | undefined;
  // A command the driver answers itself, without starting a turn (/mcp):
  // the items to show, or null to send the text as a message.
  runLocal?(text: string): Promise<ChatItem[]> | null;
  interrupt(): Promise<void>;
  // Files and folders matching a partial @mention, as the agent matches them.
  fileSuggestions?(query: string): Promise<FileSuggestion[]>;
  setModel(model: string): Promise<void>;
  setAccess(access: ChatAccess): Promise<void>;
  // Plan mode on, or back to the access setting.
  setPlan(plan: boolean): Promise<void>;
  respond(id: string, answer: ApprovalDecision): void;
  stopTask(taskId: string): Promise<void>;
  // Puts files back as they were before a message (dryRun: only say what).
  undo(checkpoint: string, dryRun: boolean): Promise<UndoResult>;
  close(): void;
  events: AsyncIterable<DriverEvent>;
}

// One per agent CLI that can be driven as chat.
export interface ChatDriver {
  id: string;
  // Plan mode, and tools served in-process (mcpServers): both Claude's
  // unless a driver says otherwise.
  plan?: boolean;
  inProcessTools?: boolean;
  start(options: ChatStartOptions): ChatConversation;
  // What the agent offers in a folder (its commands, skills and models),
  // without starting a conversation.
  discover(options: { cwd: string; env: Record<string, string> }): Promise<{
    commands: ChatCommand[];
    models: ChatModel[];
  }>;
}
