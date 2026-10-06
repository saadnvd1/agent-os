import type { ChatCommand, ChatImage, ChatModel, DriverEvent } from "./events";

export interface ChatStartOptions {
  cwd: string;
  model: string;
  // The provider's id for an existing conversation, to continue it.
  resumeId?: string | null;
  // Extra instructions appended to the provider's own system prompt.
  systemAppend?: string;
  env: Record<string, string>;
}

// One live conversation with an agent. Messages sent while a turn runs are
// queued by the provider and folded into the conversation.
export interface ChatConversation {
  send(text: string, images?: ChatImage[]): void;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
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
