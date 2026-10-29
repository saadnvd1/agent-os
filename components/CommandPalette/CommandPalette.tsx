"use client";

import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { paletteActions, paletteUi } from "@/stores/palette";
import { CommandsBody } from "./CommandsBody";
import { ConversationSearch } from "./conversations/ConversationSearch";

// ⌘K anywhere, or the header button on a phone: every action the open
// features offer, found by typing, in tabs (Tab cycles them) that include
// what was said in any chat.
export function CommandPalette() {
  const { open, tab } = useSnapshot(paletteUi);
  const wide = tab === "conversations";
  return (
    <Dialog open={open} onOpenChange={paletteActions.setOpen}>
      <DialogContent
        showCloseButton={false}
        // Sized to what the keyboard leaves visible (--app-height), not vh.
        className={cn(
          "top-[max(env(safe-area-inset-top),1rem)] flex translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-[15vh]",
          wide
            ? "h-[calc(var(--app-height,100dvh)-env(safe-area-inset-top)-2rem)] sm:h-[min(calc(var(--app-height,100dvh)-15vh-1rem),600px)] sm:max-w-4xl"
            : "max-h-[min(calc(var(--app-height,100dvh)-env(safe-area-inset-top)-2rem),560px)] sm:max-h-[min(calc(var(--app-height,100dvh)-15vh-1rem),560px)] sm:max-w-lg"
        )}
      >
        <DialogTitle className="sr-only">
          {wide ? "Search conversations" : "Command palette"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {wide
            ? "Search what was said in every conversation"
            : "Search for an action, a session or a conversation"}
        </DialogDescription>
        {/* Mounted per opening and per side, so each starts from its own query. */}
        {wide ? (
          <ConversationSearch key="conversations" />
        ) : (
          <CommandsBody key="commands" />
        )}
      </DialogContent>
    </Dialog>
  );
}
