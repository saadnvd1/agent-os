"use client";

import { Fragment } from "react";
import { Bot, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ConversationGroup, ConversationHit } from "@/data/search";
import { cn } from "@/lib/utils";
import { Snippet } from "./Snippet";
import { statusChip, whenLabel } from "./format";

export interface FlatHit {
  group: ConversationGroup;
  hit: ConversationHit;
}

export const flatten = (groups: ConversationGroup[]): FlatHit[] =>
  groups.flatMap((group) => group.hits.map((hit) => ({ group, hit })));

// Hits under their conversation: its name, where it lives, what became of it.
export function ResultList({
  groups,
  active,
  onActive,
  onPick,
}: {
  groups: ConversationGroup[];
  active: number;
  onActive: (i: number) => void;
  onPick: (i: number) => void;
}) {
  let index = -1;
  return (
    <>
      {groups.map((g) => {
        const chip = statusChip(g.status);
        const where = [g.projectName, g.workspaceName]
          .filter(Boolean)
          .join(" · ");
        return (
          <Fragment key={g.sessionId}>
            <div className="flex items-center gap-2 px-2 pt-3 pb-1">
              <p className="min-w-0 truncate text-xs font-medium">{g.name}</p>
              {chip && (
                <Badge
                  variant="outline"
                  className="h-4 shrink-0 px-1.5 text-[10px] font-normal"
                >
                  {chip}
                </Badge>
              )}
              {where && (
                <p className="text-muted-foreground min-w-0 flex-1 truncate text-right text-[11px]">
                  {where}
                </p>
              )}
            </div>
            {g.hits.map((h) => {
              const i = ++index;
              const Icon = h.role === "user" ? User : Bot;
              return (
                <button
                  key={h.itemId}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => i !== active && onActive(i)}
                  onClick={() => onPick(i)}
                  className={cn(
                    "flex min-h-11 w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-sm",
                    i === active && "bg-primary/10"
                  )}
                >
                  <Icon className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 break-words">
                      <Snippet segments={h.snippet} />
                    </span>
                  </span>
                  <span className="text-muted-foreground mt-0.5 shrink-0 text-[11px]">
                    {whenLabel(h.createdAt)}
                  </span>
                </button>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}
