import { EventEmitter } from "events";
import type {
  StreamMessage,
  StreamMessageSystem,
  StreamMessageAssistant,
  StreamMessageResult,
  ClientEvent,
  TextContent,
} from "./types";

export class StreamParser extends EventEmitter {
  private buffer = "";
  private sessionId: string;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
  }

  // Process incoming data chunk
  write(chunk: string): void {
    this.buffer += chunk;

    // Process complete lines (NDJSON format)
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        this.parseLine(line);
      }
    }
  }

  // Flush any remaining buffer
  end(): void {
    if (this.buffer.trim()) {
      this.parseLine(this.buffer);
    }
    this.buffer = "";
  }

  private parseLine(line: string): void {
    try {
      const message: StreamMessage = JSON.parse(line);
      const event = this.transformToClientEvent(message);
      if (event) {
        this.emit("event", event);
      }
    } catch (err) {
      console.error("Failed to parse stream line:", line, err);
      this.emit("parse_error", { type: "parse_error", line, error: err });
    }
  }

  private transformToClientEvent(message: StreamMessage): ClientEvent | null {
    const timestamp = new Date().toISOString();

    switch (message.type) {
      // Handle system init event
      case "system": {
        const sysMsg = message as StreamMessageSystem;
        if (sysMsg.subtype === "init") {
          return {
            type: "init",
            sessionId: this.sessionId,
            timestamp,
            data: { claudeSessionId: sysMsg.session_id || "" },
          };
        }
        return null;
      }

      // Handle assistant message (actual Claude response)
      case "assistant": {
        const assistantMsg = message as StreamMessageAssistant;
        const msg = assistantMsg.message;
        if (!msg?.content) return null;

        const textBlocks = msg.content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text || "");

        if (textBlocks.length > 0) {
          return {
            type: "text",
            sessionId: this.sessionId,
            timestamp,
            data: {
              role: msg.role || "assistant",
              text: textBlocks.join(""),
              content: msg.content.filter((c): c is TextContent => c.type === "text" && !!c.text),
            },
          };
        }
        return null;
      }

      // Legacy message format (if used)
      case "message": {
        const textBlocks = message.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text);

        if (textBlocks.length > 0) {
          return {
            type: "text",
            sessionId: this.sessionId,
            timestamp,
            data: {
              role: message.role,
              text: textBlocks.join(""),
              content: message.content,
            },
          };
        }
        return null;
      }

      case "tool_use":
        return {
          type: "tool_start",
          sessionId: this.sessionId,
          timestamp,
          data: {
            toolName: message.tool_name,
            input: message.tool_input,
          },
        };

      case "tool_result":
        return {
          type: "tool_end",
          sessionId: this.sessionId,
          timestamp,
          data: {
            toolName: message.tool_name,
            output: message.output,
            status: message.status,
          },
        };

      case "result": {
        const resultMsg = message as StreamMessageResult;
        if (resultMsg.subtype === "success" || resultMsg.status === "success") {
          return {
            type: "complete",
            sessionId: this.sessionId,
            timestamp,
            data: {
              durationMs: resultMsg.duration_ms,
              output: resultMsg.result || resultMsg.output,
            },
          };
        } else {
          return {
            type: "error",
            sessionId: this.sessionId,
            timestamp,
            data: {
              error: resultMsg.error || "Unknown error",
            },
          };
        }
      }

      default:
        return null;
    }
  }
}
