"use client";

import { Clock, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hint() {
  return (
    <p className="text-muted-foreground px-4 py-10 text-center text-sm">
      Search what you and your agents have said, in every chat.
      <span className="mt-1 block text-xs">
        Words match as you type. Quote a phrase to match it exactly.
      </span>
    </p>
  );
}

export function Recent({
  items,
  onPick,
  onClear,
}: {
  items: string[];
  onPick: (q: string) => void;
  onClear: () => void;
}) {
  if (!items.length) return <Hint />;
  return (
    <div className="p-1.5">
      <div className="flex items-center justify-between px-2 pt-2 pb-1">
        <p className="text-muted-foreground text-[11px] font-medium">Recent</p>
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground flex h-6 items-center gap-1 text-[11px]"
        >
          <X className="h-3 w-3" /> Clear
        </button>
      </div>
      {items.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onPick(q)}
          className="hover:bg-foreground/[0.05] flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm md:min-h-9"
        >
          <Clock className="text-muted-foreground h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{q}</span>
        </button>
      ))}
    </div>
  );
}

export function Skeleton() {
  return (
    <div className="space-y-4 p-3" role="status" aria-label="Searching">
      {[0, 1, 2].map((g) => (
        <div key={g} className="space-y-2">
          <div className="bg-foreground/[0.08] h-3 w-1/3 animate-pulse rounded" />
          <div className="bg-foreground/[0.06] h-9 animate-pulse rounded-lg" />
          <div className="bg-muted/40 h-9 w-5/6 animate-pulse rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function NoResults({
  query,
  scoped,
  onWiden,
}: {
  query: string;
  scoped: boolean;
  onWiden: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <SearchX className="text-muted-foreground h-6 w-6" />
      <p className="text-muted-foreground text-sm">
        Nothing said matches “{query}”.
      </p>
      {scoped && (
        <Button
          variant="outline"
          size="sm"
          onClick={onWiden}
          className="h-11 md:h-8"
        >
          Search all workspaces
        </Button>
      )}
    </div>
  );
}
