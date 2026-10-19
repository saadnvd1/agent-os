"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Chat/Markdown";
import { findRanges } from "@/components/Chat/find-highlight";
import { useMessageContext, type ConversationGroup } from "@/data/search";
import { cn } from "@/lib/utils";
import { whenLabel } from "./format";

// Marks `terms` in the preview with the browser's highlight registry, so the
// markdown and code blocks inside are never rewritten. Without the API the
// hit still scrolls into view and the result row still marks the words.
function markTerms(root: HTMLElement, terms: string[]) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return () => {};
  const ranges = terms.flatMap((t) => findRanges(root, t));
  CSS.highlights.set("conv-search", new Highlight(...ranges));
  return () => {
    CSS.highlights.delete("conv-search");
  };
}

// The message a result found with the ones around it, drawn as the chat draws
// them. On a phone it has the whole dialog and a way back to the list.
export function Preview({
  group,
  itemId,
  terms,
  onOpen,
  onBack,
}: {
  group: ConversationGroup;
  itemId: string;
  terms: string[];
  onOpen: () => void;
  onBack?: () => void;
}) {
  const {
    data: items,
    isPending,
    isError,
  } = useMessageContext(group.sessionId, itemId);
  const root = useRef<HTMLDivElement>(null);
  const termKey = terms.join(" ");
  useEffect(() => {
    const el = root.current;
    if (!el || !items) return;
    el.querySelector("[data-hit]")?.scrollIntoView({ block: "center" });
    return markTerms(el, termKey.split(" ").filter(Boolean));
  }, [items, termKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-foreground/[0.06] flex items-center gap-2 border-b px-3 py-2">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back to results"
            className="h-11 w-11 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{group.name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {[group.projectName, group.workspaceName]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button
          size="sm"
          onClick={onOpen}
          className="h-11 shrink-0 gap-1.5 md:h-8"
        >
          Open
          <CornerDownLeft className="hidden h-3.5 w-3.5 md:inline" />
        </Button>
      </div>
      <div
        ref={root}
        className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5"
      >
        {isPending && (
          <div className="space-y-3" aria-label="Loading preview">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-foreground/[0.06] h-12 animate-pulse rounded-xl"
              />
            ))}
          </div>
        )}
        {isError && (
          <p className="text-muted-foreground py-6 text-center text-sm">
            That message is gone.
          </p>
        )}
        {items?.map((m) => (
          <div
            key={m.id}
            {...(m.hit ? { "data-hit": "" } : {})}
            className={cn(
              "rounded-xl",
              m.hit && "ring-primary/30 -m-2 p-2 ring-1",
              m.role === "user" && "flex flex-col items-end"
            )}
          >
            <span className="label-mono text-muted-foreground mb-1 flex items-center gap-1.5">
              {m.role === "user" ? "You" : "Agent"}
              {m.createdAt ? <span>· {whenLabel(m.createdAt)}</span> : null}
            </span>
            {m.role === "user" ? (
              <div className="bg-foreground/[0.07] max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap">
                {m.text}
              </div>
            ) : (
              <Markdown text={m.text} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
