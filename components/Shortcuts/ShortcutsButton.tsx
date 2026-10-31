"use client";

import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortcutsUiActions } from "@/stores/shortcutsUi";

/** A footer icon that opens the shortcuts panel; on a phone it is the only way in. */
export function ShortcutsButton() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title="Keyboard shortcuts (?)"
      aria-label="Keyboard shortcuts"
      onClick={() => shortcutsUiActions.open()}
      className="text-muted-foreground relative h-8 w-8 after:absolute after:-inset-1.5 after:content-[''] md:after:hidden [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11"
    >
      <Keyboard className="h-4 w-4" />
    </Button>
  );
}
