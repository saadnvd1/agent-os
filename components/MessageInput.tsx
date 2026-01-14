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
    <form onSubmit={handleSubmit} className="border-border border-t p-4">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="bg-muted border-input placeholder:text-muted-foreground focus:ring-ring flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:opacity-50"
        />

        {disabled && onCancel ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            onClick={onCancel}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" disabled={!text.trim() || disabled}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>

      <p className="text-muted-foreground mt-2 text-xs">
        Press Enter to send, Shift+Enter for new line
      </p>
    </form>
  );
}
