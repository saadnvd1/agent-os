"use client";

import { useSnapshot } from "valtio";
import { shortcutsUi } from "@/stores/shortcutsUi";

/** The first key of a sequence, shown until the second comes or time runs out. */
export function PendingKeys() {
  const { pending } = useSnapshot(shortcutsUi);
  if (!pending) return null;
  return (
    <div
      role="status"
      className="bg-popover text-popover-foreground border-foreground/10 pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-3 py-1.5 text-sm shadow-md"
    >
      <kbd className="font-mono font-medium uppercase">{pending}</kbd>
      <span className="text-muted-foreground ml-2">then…</span>
    </div>
  );
}
