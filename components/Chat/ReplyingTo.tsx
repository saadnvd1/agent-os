"use client";

// Above the composer while it answers a question from the orchestrator's strip.
export function ReplyingTo({
  text,
  onStop,
}: {
  text: string;
  onStop: () => void;
}) {
  return (
    <div className="text-muted-foreground mb-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs">
      <span className="min-w-0 flex-1 truncate">Answering: {text}</span>
      <button
        type="button"
        onClick={onStop}
        aria-label="Stop answering"
        className="hover:text-foreground flex size-11 shrink-0 items-center justify-center"
      >
        ×
      </button>
    </div>
  );
}
