"use client";

import { cn } from "@/lib/utils";

// The paths a claim touches, the ones another claim also touches marked.
export function ClaimFiles({
  files,
  more,
  shared,
}: {
  files: string[];
  more: number;
  shared: ReadonlySet<string>;
}) {
  return (
    <ul className="bg-muted/40 mt-1 max-h-48 overflow-y-auto rounded-lg p-2 font-mono text-[11px] leading-5">
      {files.map((f) => (
        <li
          key={f}
          className={cn(
            "break-all",
            shared.has(f)
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground"
          )}
        >
          {f}
        </li>
      ))}
      {more > 0 && (
        <li className="text-muted-foreground pt-1">and {more} more</li>
      )}
      {files.length === 0 && more === 0 && (
        <li className="text-muted-foreground">No changed files yet</li>
      )}
    </ul>
  );
}
