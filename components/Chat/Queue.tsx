"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, SendHorizontal, X } from "lucide-react";
import type { QueuedMessage } from "@/lib/chat/events";
import { cn } from "@/lib/utils";

// Messages written while the agent works, above the composer. They go in
// order when the turn ends; until then each can be edited, moved, dropped,
// or sent now, which stops the turn for it.
export function Queue({
  queue,
  running,
  onEdit,
  onMove,
  onDelete,
  onSendNow,
}: {
  queue: QueuedMessage[];
  running: boolean;
  onEdit: (id: string, text: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onDelete: (id: string) => void;
  onSendNow: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  );
  if (!queue.length) return null;

  const save = () => {
    if (editing) onEdit(editing.id, editing.text);
    setEditing(null);
  };

  return (
    <section
      aria-label="Queued messages"
      className="bg-card popover-surface mb-2 rounded-2xl p-1.5"
    >
      <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs">
        {running
          ? `Sends when this turn ends · ${queue.length} queued`
          : `${queue.length} queued`}
      </p>
      <ol className="flex flex-col gap-1">
        {queue.map((m, i) => (
          <li
            key={m.id}
            data-esc-local={editing?.id === m.id ? "" : undefined}
            className="bg-foreground/[0.03] flex items-start gap-1 rounded-xl p-1"
          >
            <span className="text-muted-foreground w-5 shrink-0 pt-3 text-center text-xs tabular-nums">
              {i + 1}
            </span>
            {editing?.id === m.id ? (
              <textarea
                autoFocus
                value={editing.text}
                aria-label="Edit queued message"
                onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                onBlur={save}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    // Esc here cancels the edit; it doesn't stop the turn.
                    setEditing(null);
                  } else if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    save();
                  }
                }}
                rows={Math.min(6, editing.text.split("\n").length + 1)}
                className="bg-background min-h-11 min-w-0 flex-1 resize-none rounded-lg px-2 py-2 text-base outline-none md:text-sm"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing({ id: m.id, text: m.text })}
                className="min-h-11 min-w-0 flex-1 rounded-lg px-2 py-2.5 text-left text-sm break-words whitespace-pre-wrap"
                title="Edit"
              >
                <span className="line-clamp-3">{m.text}</span>
                {m.imageCount ? (
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {m.imageCount} image{m.imageCount > 1 ? "s" : ""}
                  </span>
                ) : null}
              </button>
            )}
            <div className="flex shrink-0 items-center">
              <IconButton
                label="Send now"
                onClick={() => onSendNow(m.id)}
                className="text-foreground"
              >
                <SendHorizontal className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="Edit"
                onClick={() => setEditing({ id: m.id, text: m.text })}
                className="max-md:hidden"
              >
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Move up"
                disabled={i === 0}
                onClick={() => onMove(m.id, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="Move down"
                disabled={i === queue.length - 1}
                onClick={() => onMove(m.id, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </IconButton>
              <IconButton label="Remove" onClick={() => onDelete(m.id)}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function IconButton({
  label,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-11 w-11 items-center justify-center rounded-lg disabled:opacity-30 md:h-9 md:w-8 pointer-coarse:h-11 pointer-coarse:w-11",
        className
      )}
    />
  );
}
