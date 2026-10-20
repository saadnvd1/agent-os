"use client";

import { useState } from "react";
import { ChevronRight, ExternalLink, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Claim } from "@/lib/claims/types";
import { ClaimFiles } from "./ClaimFiles";
import { startedText } from "./format";

// One piece of claimed work: what, where, since when; its files fold open.
export function ClaimRow({
  claim,
  here,
  now,
  shared,
}: {
  claim: Claim;
  here: boolean;
  now: number;
  shared: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const count = claim.files.length + claim.filesMore;
  return (
    <li className="bg-muted/40 rounded-xl" data-claim={claim.id}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-start gap-2 rounded-xl p-3 text-left"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "text-muted-foreground mt-0.5 h-4 w-4 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium break-words">
            {claim.goal}
          </span>
          <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span>
              {here ? `${claim.originName} (here)` : claim.originName}
            </span>
            {claim.branch && (
              <span className="flex min-w-0 items-center gap-1">
                <GitBranch aria-hidden className="h-3 w-3 shrink-0" />
                <span className="truncate">{claim.branch}</span>
              </span>
            )}
            <span>{startedText(claim, now)}</span>
            <span>
              {count} file{count === 1 ? "" : "s"}
            </span>
          </span>
        </span>
      </button>
      {claim.prUrl && (
        <a
          href={claim.prUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary flex min-h-11 items-center gap-1 px-3 pb-2 pl-9 text-xs hover:underline"
        >
          <ExternalLink aria-hidden className="h-3 w-3" />
          Pull request
        </a>
      )}
      {open && (
        <div className="px-3 pb-3 pl-9">
          <ClaimFiles
            files={claim.files}
            more={claim.filesMore}
            shared={shared}
          />
        </div>
      )}
    </li>
  );
}
