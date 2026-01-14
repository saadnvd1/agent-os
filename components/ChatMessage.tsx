"use client";

import { cn } from "@/lib/utils";
import { User, Bot } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export function ChatMessage({
  role,
  content,
  timestamp,
  isStreaming,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg p-4",
        isUser ? "bg-muted/50" : "bg-card"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary" : "bg-muted"
        )}
      >
        {isUser ? (
          <User className="text-primary-foreground h-4 w-4" />
        ) : (
          <Bot className="text-muted-foreground h-4 w-4" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-medium">
            {isUser ? "You" : "Claude"}
          </span>
          <span className="text-muted-foreground text-xs">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
          {isStreaming && (
            <span className="text-primary animate-pulse text-xs">
              streaming...
            </span>
          )}
        </div>

        <div className="text-sm break-words whitespace-pre-wrap">
          {content}
          {isStreaming && (
            <span className="bg-primary ml-0.5 inline-block h-4 w-2 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
