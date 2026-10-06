import type {
  ApprovalDecision,
  ChatAccess,
  ChatCommand,
  ChatImage,
  ChatModel,
  DriverEvent,
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
  // Extra instructions appended to the provider's own system prompt.
  systemAppend?: string;
  env: Record<string, string>;
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
  send(text: string, images?: ChatImage[]): string | undefined;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setAccess(access: ChatAccess): Promise<void>;
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
  start(options: ChatStartOptions): ChatConversation;
  // What the agent offers in a folder (its commands, skills and models),
  // without starting a conversation.
  discover(options: { cwd: string; env: Record<string, string> }): Promise<{
    commands: ChatCommand[];
    models: ChatModel[];
  }>;
}
