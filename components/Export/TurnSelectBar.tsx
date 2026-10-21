"use client";

import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import { exportUi, exportUiActions, pickedRange } from "@/stores/exportUi";
import { tokenLabel } from "@/lib/export/view";

// The bar under the chat while turns are being picked for an export.
export function TurnSelectBar() {
  const { pick, turns } = useSnapshot(exportUi);
  const range = pickedRange(pick);
  const picked = range
    ? turns.filter((t) => t.n >= range.from && t.n <= range.to)
    : [];
  const tokens = picked.reduce((sum, t) => sum + t.tokens, 0);
  const count = range ? range.to - range.from + 1 : 0;
  const text = !range
    ? "Tap the first turn to export"
    : pick.to === null
      ? `Turn ${range.from} · tap the last turn, or export just this one`
      : `Turns ${range.from}–${range.to} · ${count} ${count === 1 ? "turn" : "turns"} · ${tokenLabel(tokens)}`;
  return (
    <div
      role="region"
      aria-label="Select turns to export"
      className="bg-background fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <p className="min-w-[140px] flex-1 text-sm">{text}</p>
      <Button
        variant="outline"
        className="min-h-11"
        onClick={exportUiActions.cancelSelect}
      >
        Cancel
      </Button>
      <Button
        className="min-h-11"
        disabled={!range}
        onClick={exportUiActions.finishSelect}
      >
        Export…
      </Button>
    </div>
  );
}
