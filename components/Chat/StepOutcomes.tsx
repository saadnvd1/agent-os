"use client";

import type { ToolItem } from "@/lib/chat/group";
import { failedSteps } from "@/lib/chat/step-summary";

// Under a collapsed group that had failures: which steps failed. Nothing when
// every step passed.
export function StepOutcomes({
  tools,
  onOpen,
}: {
  tools: ToolItem[];
  onOpen: () => void;
}) {
  const { names, more } = failedSteps(tools);
  if (names.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Show steps"
      className="text-destructive flex min-h-8 w-full min-w-0 items-center gap-x-3 px-2 pb-1 text-left text-xs md:min-h-0"
    >
      <span className="min-w-0 truncate">
        {names.map((n) => `✕ ${n}`).join("  ")}
        {more > 0 && `  +${more} more`}
      </span>
    </button>
  );
}
