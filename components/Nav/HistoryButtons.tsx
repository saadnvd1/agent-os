"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLongPress } from "@/components/Chat/useLongPress";
import { earlier, later, type MirrorEntry } from "@/lib/nav/history-mirror";
import { isMac } from "@/lib/keybindings/chord";
import { navHistory, navHistoryActions } from "@/stores/navHistory";

const KEYS_BACK = () => (isMac() ? "⌘[" : "Alt+←");
const KEYS_FORWARD = () => (isMac() ? "⌘]" : "Alt+→");

function useReach() {
  const snap = useSnapshot(navHistory);
  const m = { entries: [...snap.entries], current: snap.current };
  return { back: earlier(m), forward: later(m) };
}

function Entries({ entries }: { entries: MirrorEntry[] }) {
  return entries.slice(0, 15).map((e) => (
    <DropdownMenuItem
      key={e.index}
      className="min-h-11 md:min-h-0"
      onSelect={() => navHistoryActions.goTo(e.index)}
    >
      <span className="truncate">{e.name || "Chat"}</span>
    </DropdownMenuItem>
  ));
}

/** One history button: tap goes a step; hold (touch) or right-click opens the list of chats it would pass. */
function HistoryButton({
  dir,
  entries,
  className,
}: {
  dir: "back" | "forward";
  entries: MirrorEntry[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hold = useLongPress(entries.length > 0 ? () => setOpen(true) : null);
  const Icon = dir === "back" ? ArrowLeft : ArrowRight;
  const label = dir === "back" ? "Back" : "Forward";
  const hint = dir === "back" ? KEYS_BACK() : KEYS_FORWARD();
  const go = () =>
    dir === "back" ? navHistoryActions.back() : navHistoryActions.forward();
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={entries.length === 0}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        go();
      }}
      onContextMenu={(e) => {
        if (entries.length === 0) return;
        e.preventDefault();
        setOpen(true);
      }}
      {...hold}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{`${label} (${hint})`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-w-72">
        <DropdownMenuLabel>
          {dir === "back" ? "Earlier" : "Later"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Entries entries={entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Desktop: back and forward through the chats and bookmarks visited. */
export function HistoryButtons() {
  const { back, forward } = useReach();
  return (
    <>
      <HistoryButton dir="back" entries={back} className="h-7 w-7 shrink-0" />
      <HistoryButton
        dir="forward"
        entries={forward}
        className="h-7 w-7 shrink-0"
      />
    </>
  );
}

/** Phone: the back button beside the menu; hold it for the list. */
export function PhoneBackButton() {
  const { back } = useReach();
  return (
    <HistoryButton
      dir="back"
      entries={back}
      className="relative h-8 w-8 shrink-0 after:absolute after:-inset-1.5 after:content-['']"
    />
  );
}
