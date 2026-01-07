"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "./ChatMessage";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { MessageInput } from "./MessageInput";
import { ScrollArea } from "./ui/scroll-area";
import type { ClientEvent } from "@/lib/claude/types";
import type { Message } from "@/lib/db";

interface ChatViewProps {
  sessionId: string;
  initialMessages?: Message[];
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    output?: string;
    status: "pending" | "running" | "completed" | "error";
  }>;
}

export function ChatView({ sessionId, initialMessages = [] }: ChatViewProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>(() =>
    initialMessages.map((m) => {
      let content = "";
      try {
        const parsed = JSON.parse(m.content);
        content = parsed
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text)
          .join("");
      } catch {
        content = m.content;
      }
      return {
        id: String(m.id),
        role: m.role,
        content,
        timestamp: m.timestamp,
      };
    })
  );
  const [currentText, setCurrentText] = useState("");
  const [currentToolCalls, setCurrentToolCalls] = useState<
    DisplayMessage["toolCalls"]
  >([]);
  const [status, setStatus] = useState<
    "idle" | "running" | "waiting" | "error"
  >("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Refs to track current streaming state (avoids closure issues)
  const currentTextRef = useRef("");
  const currentToolCallsRef = useRef<DisplayMessage["toolCalls"]>([]);

  // Reset messages when session changes
  useEffect(() => {
    setMessages(
      initialMessages.map((m) => {
        let content = "";
        try {
          const parsed = JSON.parse(m.content);
          content = parsed
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text: string }) => c.text)
            .join("");
        } catch {
          content = m.content;
        }
        return {
          id: String(m.id),
          role: m.role,
          content,
          timestamp: m.timestamp,
        };
      })
    );
    setCurrentText("");
    setCurrentToolCalls([]);
    currentTextRef.current = "";
    currentToolCallsRef.current = [];
  }, [sessionId, initialMessages]);

  useEffect(() => {
    let ignore = false;
    let ws: WebSocket | null = null;

    // Connect to Claude WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/claude/${sessionId}`
    );

    ws.onopen = () => {
      if (ignore) {
        ws?.close();
        return;
      }
      wsRef.current = ws;
    };

    ws.onmessage = (event) => {
      if (ignore) return;
      const data: ClientEvent = JSON.parse(event.data);

      switch (data.type) {
        case "status":
          setStatus(
            (data.data as { status: "idle" | "running" | "waiting" | "error" })
              .status
          );
          break;

        case "text": {
          const textData = data.data as { role: string; text: string };
          if (textData.role === "assistant") {
            setCurrentText((prev) => {
              const newText = prev + textData.text;
              currentTextRef.current = newText;
              return newText;
            });
          }
          break;
        }

        case "tool_start": {
          const toolStartData = data.data as {
            toolName: string;
            input: Record<string, unknown>;
          };
          setCurrentToolCalls((prev) => {
            const newCalls = [
              ...(prev || []),
              {
                name: toolStartData.toolName,
                input: toolStartData.input,
                status: "running" as const,
              },
            ];
            currentToolCallsRef.current = newCalls;
            return newCalls;
          });
          break;
        }

        case "tool_end": {
          const toolEndData = data.data as {
            toolName: string;
            output: string;
            status: string;
          };
          setCurrentToolCalls((prev) => {
            const newCalls = prev?.map((tc) =>
              tc.name === toolEndData.toolName && tc.status === "running"
                ? {
                    ...tc,
                    output: toolEndData.output,
                    status: toolEndData.status as "completed" | "error",
                  }
                : tc
            );
            currentToolCallsRef.current = newCalls;
            return newCalls;
          });
          break;
        }

        case "complete":
        case "error": {
          // Finalize current message using refs (avoids stale closure)
          const finalText = currentTextRef.current;
          const finalToolCalls = currentToolCallsRef.current;

          if (finalText || (finalToolCalls && finalToolCalls.length > 0)) {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}`,
                role: "assistant",
                content: finalText,
                timestamp: data.timestamp,
                toolCalls: finalToolCalls,
              },
            ]);
          }
          // Reset state and refs
          setCurrentText("");
          setCurrentToolCalls([]);
          currentTextRef.current = "";
          currentToolCallsRef.current = [];
          break;
        }
      }
    };

    ws.onclose = () => {
      if (!ignore) {
        setStatus("idle");
      }
    };

    return () => {
      ignore = true;
      wsRef.current = null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [sessionId]);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentText]);

  const sendMessage = (text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Add user message to display
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      },
    ]);

    // Send to Claude
    wsRef.current.send(
      JSON.stringify({
        type: "prompt",
        prompt: text,
        options: { resume: true },
      })
    );
  };

  const cancelRequest = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cancel" }));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              <ChatMessage
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
              />
              {msg.toolCalls?.map((tc, i) => (
                <ToolCallDisplay
                  key={`${msg.id}-tool-${i}`}
                  name={tc.name}
                  input={tc.input}
                  output={tc.output}
                  status={tc.status}
                />
              ))}
            </div>
          ))}

          {/* Streaming content */}
          {(currentText ||
            (currentToolCalls && currentToolCalls.length > 0)) && (
            <div>
              {currentText && (
                <ChatMessage
                  role="assistant"
                  content={currentText}
                  timestamp={new Date().toISOString()}
                  isStreaming
                />
              )}
              {currentToolCalls?.map((tc, i) => (
                <ToolCallDisplay
                  key={`streaming-tool-${i}`}
                  name={tc.name}
                  input={tc.input}
                  output={tc.output}
                  status={tc.status}
                />
              ))}
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <MessageInput
        onSend={sendMessage}
        onCancel={status === "running" ? cancelRequest : undefined}
        disabled={status === "running"}
        placeholder={
          status === "running" ? "Claude is thinking..." : "Send a message..."
        }
      />
    </div>
  );
}
