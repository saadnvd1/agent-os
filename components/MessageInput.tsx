"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Send, Square } from "lucide-react";

interface MessageInputProps {
  onSend: (message: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageInput({
  onSend,
  onCancel,
  disabled,
  placeholder = "Send a message...",
}: MessageInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, [text]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() && !disabled) {
      onSend(text.trim());
      setText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-border p-4">
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-muted border border-input rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />

        {disabled && onCancel ? (
          <Button type="button" variant="destructive" size="icon" onClick={onCancel}>
            <Square className="w-4 h-4" />
          </Button>
        ) : (
          <Button type="submit" disabled={!text.trim() || disabled}>
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        Press Enter to send, Shift+Enter for new line
      </p>
    </form>
  );
}
