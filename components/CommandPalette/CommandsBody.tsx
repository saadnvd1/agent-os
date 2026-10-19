"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { MessagesSquare, Search, type LucideIcon } from "lucide-react";
import { matchCommands, type PaletteCommand } from "@/lib/palette/registry";
import { cn } from "@/lib/utils";
import { MIN_QUERY, useConversationSearch } from "@/data/search";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePaletteList } from "@/hooks/usePaletteCommands";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import { paletteActions, paletteUi } from "@/stores/palette";
import { plain } from "./conversations/format";
import { useOpenHit } from "./conversations/useOpenHit";

// How many of a long group (sessions) show before a query narrows it.
const GROUP_PREVIEW = 8;
// Conversation matches offered beside the commands.
const CONVERSATIONS = 3;

export function CommandsBody() {
  const commands = usePaletteList();
  // Subscribed for changes, read raw: its items are held by ref.
  useSnapshot(paletteUi);
  const picker = paletteUi.picker;
  const all = picker?.items ?? commands;
  const [query, setQuery] = useState(paletteUi.query);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Conversations that match, under the commands (never in a picker).
  const { workspace } = useSelectedWorkspace();
  const debounced = useDebouncedValue(query.trim(), 150);
  const openHit = useOpenHit();
  const { data: found } = useConversationSearch(
    debounced,
    workspace?.id ?? "all",
    {
      limit: CONVERSATIONS,
      enabled: !picker,
    }
  );
  const conversations = useMemo<PaletteCommand[]>(() => {
    const q = query.trim();
    if (picker || q.length < MIN_QUERY || q !== debounced) return [];
    const hits = (found?.groups ?? []).flatMap((group) =>
      group.hits.slice(0, 1).map((hit) => ({
        id: `conversation:${group.sessionId}:${hit.itemId}`,
        title: group.name,
        detail: plain(hit.snippet),
        group: "Conversations",
        icon: MessagesSquare,
        run: () => openHit(group, hit),
        keepOpen: true,
      }))
    );
    return [
      ...hits,
      {
        id: "conversation:all",
        title: `Search all conversations for “${q}”`,
        group: "Conversations",
        icon: Search,
        hint: "tab",
        keepOpen: true,
        run: () => paletteActions.setMode("conversations", q),
      },
    ];
  }, [found, query, debounced, picker, openHit]);

  const results = useMemo(() => {
    if (query.trim()) return [...matchCommands(all, query), ...conversations];
    // A picker shows every choice; it's the whole list.
    if (picker) return all;
    // With no query, long groups are cut short so every group shows.
    const seen = new Map<string, number>();
    return all.filter((c) => {
      const n = (seen.get(c.group) ?? 0) + 1;
      seen.set(c.group, n);
      return n <= GROUP_PREVIEW;
    });
  }, [all, query, picker, conversations]);
  const highlighted = Math.min(active, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    if (c.keepOpen) return c.run();
    paletteActions.setOpen(false);
    // After the dialog lets go of focus, so what it opens can take it.
    setTimeout(() => c.run(), 0);
  };

  // Under their headings with no query; one ranked list with one.
  const groups: { name: string; items: { c: PaletteCommand; i: number }[] }[] =
    [];
  results.forEach((c, i) => {
    const name = query.trim() && c.group !== "Conversations" ? "" : c.group;
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
            } else if (e.key === "Tab" && !picker) {
              e.preventDefault();
              paletteActions.setMode("conversations", query);
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[highlighted]);
            } else if (
              picker &&
              (e.metaKey || e.ctrlKey) &&
              /^[1-9]$/.test(e.key)
            ) {
              e.preventDefault();
              run(picker.items[Number(e.key) - 1]);
            }
          }}
          placeholder={
            picker?.placeholder ?? "Search actions, sessions and conversations…"
          }
          aria-label={
            picker?.placeholder ?? "Search actions, sessions and conversations"
          }
          className="placeholder:text-muted-foreground h-12 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
        />
        <kbd className="text-muted-foreground hidden font-mono text-[10px] sm:inline">
          esc
        </kbd>
      </div>
      <div
        ref={listRef}
        role="listbox"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.title}</span>
                    {c.detail && (
                      <span className="text-muted-foreground block truncate text-xs">
                        {c.detail}
                      </span>
                    )}
                  </span>
                  {query.trim() && c.group !== "Conversations" && (
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
