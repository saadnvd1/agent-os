"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { foldUnchanged } from "@/lib/artifacts/compare/diff";
import type { DiffLine, WordPart } from "@/lib/artifacts/compare/types";

const ROW = {
  eq: "",
  add: "bg-emerald-500/10",
  del: "bg-red-500/10",
} as const;
const SIGN = {
  eq: " ",
  add: "+",
  del: "−",
} as const;
const SIGN_TONE = {
  eq: "text-muted-foreground",
  add: "text-emerald-700 dark:text-emerald-400",
  del: "text-red-700 dark:text-red-400",
} as const;
const WORD = {
  add: "bg-emerald-500/30",
  del: "bg-red-500/30 line-through decoration-red-500/60",
} as const;

function Words({ parts }: { parts: WordPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.t === "eq" ? (
          <span key={i}>{p.s}</span>
        ) : (
          <mark key={i} className={cn("rounded-sm text-inherit", WORD[p.t])}>
            {p.s}
          </mark>
        )
      )}
    </>
  );
}

function Row({ line, wrap }: { line: DiffLine; wrap: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1.75rem_1fr] font-mono text-xs leading-relaxed",
        ROW[line.t]
      )}
    >
      <span
        aria-hidden
        className={cn("text-center select-none", SIGN_TONE[line.t])}
      >
        {SIGN[line.t]}
      </span>
      <span
        className={cn(
          "min-w-0 pr-3",
          wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre"
        )}
      >
        {line.words ? <Words parts={line.words} /> : line.s}
      </span>
    </div>
  );
}

// A unified diff: removed lines, then added, with unchanged stretches folded.
export function DiffView({
  lines,
  wrap,
}: {
  lines: DiffLine[];
  // Text wraps; source scrolls sideways.
  wrap: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = useMemo(
    () => (all ? lines : foldUnchanged(lines)),
    [all, lines]
  );
  const folded = shown.some((s) => "gap" in s);
  return (
    <div className="flex flex-col">
      <div className={cn("py-2", !wrap && "overflow-x-auto")}>
        <div className={cn(!wrap && "w-max min-w-full")}>
          {shown.map((s, i) =>
            "gap" in s ? (
              <button
                key={i}
                type="button"
                onClick={() => setAll(true)}
                className="text-muted-foreground hover:text-foreground bg-muted/50 my-1 flex min-h-11 w-full items-center justify-center text-xs md:min-h-7"
              >
                {s.gap} unchanged {s.gap === 1 ? "line" : "lines"} · show all
              </button>
            ) : (
              <Row key={i} line={s} wrap={wrap} />
            )
          )}
        </div>
      </div>
      {all && folded === false && lines.some((l) => l.t !== "eq") && (
        <button
          type="button"
          onClick={() => setAll(false)}
          className="text-muted-foreground hover:text-foreground min-h-11 text-xs md:min-h-9"
        >
          Fold unchanged lines
        </button>
      )}
    </div>
  );
}
