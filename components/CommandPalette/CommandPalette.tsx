"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { Search, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { matchCommands, type PaletteCommand } from "@/lib/palette/registry";
import { cn } from "@/lib/utils";
import { usePaletteList } from "@/hooks/usePaletteCommands";
import { paletteActions, paletteUi } from "@/stores/palette";

// How many of a long group (sessions) show before a query narrows it.
const GROUP_PREVIEW = 8;

// ⌘K anywhere, or the header button on a phone: every action the open
// features offer, found by typing.
export function CommandPalette() {
  const { open } = useSnapshot(paletteUi);
  return (
    <Dialog open={open} onOpenChange={paletteActions.setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[max(env(safe-area-inset-top),1rem)] max-h-[min(70vh,560px)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[15vh] sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search for an action or a session
        </DialogDescription>
        {/* Mounted per opening, so each starts with an empty query. */}
        <PaletteBody />
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody() {
  const all = usePaletteList();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (query.trim()) return matchCommands(all, query);
    // With no query, long groups are cut short so every group shows.
    const seen = new Map<string, number>();
    return all.filter((c) => {
      const n = (seen.get(c.group) ?? 0) + 1;
      seen.set(c.group, n);
      return n <= GROUP_PREVIEW;
    });
  }, [all, query]);
  const highlighted = Math.min(active, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    paletteActions.setOpen(false);
    // After the dialog lets go of focus, so what it opens can take it.
    setTimeout(() => c.run(), 0);
  };

  // Under their headings with no query; one ranked list with one.
  const groups: { name: string; items: { c: PaletteCommand; i: number }[] }[] =
    [];
  results.forEach((c, i) => {
    const name = query.trim() ? "" : c.group;
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push({ c, i });
  });

  return (
    <>
      <div className="border-foreground/[0.06] flex items-center gap-2 border-b px-3">
        <Search className="text-muted-foreground h-4 w-4 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = results.length || 1;
              setActive(
                (highlighted + (e.key === "ArrowDown" ? 1 : -1) + n) % n
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[highlighted]);
            }
          }}
          placeholder="Search actions and sessions…"
          aria-label="Search actions and sessions"
          className="placeholder:text-muted-foreground h-12 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
        />
        <kbd className="text-muted-foreground hidden font-mono text-[10px] sm:inline">
          esc
        </kbd>
      </div>
      <div
        ref={listRef}
        role="listbox"
        className="max-h-[calc(min(70vh,560px)-3rem)] overflow-y-auto overscroll-contain p-1.5"
      >
        {results.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Nothing matches.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.name || "results"} className="mb-1">
            {g.name && (
              <p className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-medium">
                {g.name}
              </p>
            )}
            {g.items.map(({ c, i }) => {
              const Icon = c.icon as LucideIcon | undefined;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={i === highlighted}
                  data-index={i}
                  onMouseMove={() => i !== highlighted && setActive(i)}
                  onClick={() => run(c)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm md:min-h-9",
                    i === highlighted && "bg-primary/10"
                  )}
                >
                  {Icon && (
                    <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  {query.trim() && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {c.group}
                    </span>
                  )}
                  {c.hint && (
                    <kbd className="text-muted-foreground hidden shrink-0 font-mono text-[11px] sm:inline">
                      {c.hint}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
