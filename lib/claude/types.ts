// Stream-JSON message types from Claude CLI

export interface StreamMessageInit {
  type: "init";
  session_id: string;
  timestamp: string;
}

export interface StreamMessageSystem {
  type: "system";
  subtype: "init" | string;
  session_id?: string;
  timestamp?: string;
}

export interface StreamMessageAssistant {
  type: "assistant";
  message: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
}

export interface StreamMessageContent {
  type: "message";
  role: "assistant" | "user";
  content: ContentBlock[];
  timestamp: string;
}

export interface StreamMessageToolUse {
  type: "tool_use";
  tool_name: string;
  tool_input: Record<string, unknown>;
  timestamp: string;
}

export interface StreamMessageToolResult {
  type: "tool_result";
  tool_name: string;
  output: string;
  status: "success" | "error";
  timestamp: string;
}

export interface StreamMessageResult {
  type: "result";
  subtype?: "success" | "error";
  status?: "success" | "error";
  duration_ms?: number;
  result?: string;
  output?: string;
  error?: string;
  timestamp?: string;
}

export type StreamMessage =
  | StreamMessageInit
  | StreamMessageSystem
  | StreamMessageAssistant
  | StreamMessageContent
  | StreamMessageToolUse
  | StreamMessageToolResult
  | StreamMessageResult;

// Content block types
export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent;

// Client events (sent to WebSocket clients)
export interface ClientEventInit {
  type: "init";
  sessionId: string;
  timestamp: string;
  data: { claudeSessionId: string };
}

export interface ClientEventText {
  type: "text";
  sessionId: string;
  timestamp: string;
  data: { role: string; text: string; content: ContentBlock[] };
}

export interface ClientEventToolStart {
  type: "tool_start";
  sessionId: string;
  timestamp: string;
  data: { toolName: string; input: Record<string, unknown> };
}

export interface ClientEventToolEnd {
  type: "tool_end";
  sessionId: string;
  timestamp: string;
  data: { toolName: string; output: string; status: string };
}

export interface ClientEventComplete {
  type: "complete";
  sessionId: string;
  timestamp: string;
  data: { durationMs?: number; output?: string };
}

export interface ClientEventError {
  type: "error";
  sessionId: string;
  timestamp: string;
  data: { error: string };
}

export interface ClientEventStatus {
  type: "status";
  sessionId: string;
  timestamp: string;
  data: { status: string; exitCode?: number };
}

export type ClientEvent =
  | ClientEventInit
  | ClientEventText
  | ClientEventToolStart
  | ClientEventToolEnd
  | ClientEventComplete
  | ClientEventError
  | ClientEventStatus;

// Session options
export interface ClaudeSessionOptions {
  model?: string;
  workingDirectory?: string;
  resume?: boolean; // Use --continue or --resume
  claudeSessionId?: string; // For --resume
  systemPrompt?: string;
}
