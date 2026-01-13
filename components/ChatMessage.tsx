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
        "flex gap-3 p-4 rounded-lg",
        isUser ? "bg-muted/50" : "bg-card"
      )}
    >
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser ? "bg-primary" : "bg-muted"
        )}
      >
        {isUser ? (
          <User className="w-4 h-4 text-primary-foreground" />
        ) : (
          <Bot className="w-4 h-4 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">
            {isUser ? "You" : "Claude"}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
          {isStreaming && (
            <span className="text-xs text-primary animate-pulse">
              streaming...
            </span>
          )}
        </div>

        <div className="text-sm whitespace-pre-wrap break-words">
          {content}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-0.5 bg-primary animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
