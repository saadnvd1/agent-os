"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchTurnCopy } from "@/data/exports";
import { useBookmarkChat, useTurnStart } from "@/components/Bookmarks/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Part = "response" | "full";

// "Copy" on a finished turn's end line: the answer alone, or the whole turn
// (reasoning, tools, output, errors) as Markdown. One menu, so a phone's
// turn row gets one button, not two.
export function TurnCopy({ turnEndId }: { turnEndId: string }) {
  const chat = useBookmarkChat();
  const start = useTurnStart(turnEndId);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  if (!chat || !start) return null;

  const copy = async (part: Part) => {
    try {
      const turn = await fetchTurnCopy(chat.sessionId, start);
      const text = part === "full" ? turn.full : turn.response;
      if (!text) throw new Error("nothing to copy");
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Copy turn"
          className={cn(
            "hover:text-foreground hover:bg-foreground/[0.06] -my-2 flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 md:-my-1 md:min-h-7",
            state === "idle"
              ? "opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
              : state === "failed"
                ? "text-destructive"
                : "text-foreground"
          )}
        >
          {state === "copied" ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          <span className="md:hidden">
            {state === "failed"
              ? "Copy failed"
              : state === "copied"
                ? "Copied"
                : "Copy"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="font-sans text-sm">
        <DropdownMenuItem
          className="min-h-11 md:min-h-8"
          onSelect={() => void copy("response")}
        >
          Copy Response
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 md:min-h-8"
          onSelect={() => void copy("full")}
        >
          Copy Full Turn
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
