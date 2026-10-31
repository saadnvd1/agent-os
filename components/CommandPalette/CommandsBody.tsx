"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { ArrowRight, Search } from "lucide-react";
import { type PaletteCommand, type PaletteTab } from "@/lib/palette/registry";
import {
  allSections,
  emptySections,
  withSeeAll,
  tabItems,
  CURRENT,
  type Section,
} from "@/lib/palette/sections";
import { cycleTab, parsePrefix } from "@/lib/palette/tabs";
import { loadUsage, noteUse } from "@/lib/palette/usage";
import { usePaletteList } from "@/hooks/usePaletteCommands";
import { paletteActions, paletteUi } from "@/stores/palette";
import { PaletteRows } from "./PaletteRows";
import { PaletteTabs } from "./PaletteTabs";
import { useConversationRows } from "./useConversationRows";

const PLACEHOLDER: Record<PaletteTab, string> = {
  all: "Search everything…",
  sessions: "Search sessions…",
  commands: "Search commands…",
  settings: "Search settings…",
  conversations: "",
};
// A tab's rows are cut here, so a long list stays quick to draw.
const TAB_LIMIT = 100;

export function CommandsBody() {
  const commands = usePaletteList();
  // Subscribed for changes, read raw: its items are held by ref.
  useSnapshot(paletteUi);
  const picker = paletteUi.picker;
  const tab = paletteUi.tab;
  const all = picker?.items ?? commands;
  const [query, setQuery] = useState(paletteUi.query);
  // Null until the reader moves: the list then picks where to start.
  const [active, setActive] = useState<number | null>(null);
  // The tab a `>` or `@` chose, which Backspace on an empty query undoes.
  const [prefixTab, setPrefixTab] = useState<PaletteTab | null>(null);
  const [usage, setUsage] = useState(loadUsage);
  const [now] = useState(Date.now);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim();

  const conversations = useConversationRows(query, !picker && tab === "all");

  const sections = useMemo<Section[]>(() => {
    // A picker shows every choice; it's the whole list.
    if (picker) return [{ name: "", items: all }];
    if (tab === "all") {
      if (!q) return emptySections(all, usage);
      const found = withSeeAll(
        allSections(all, query, usage, now),
        (to) => paletteActions.setTab(to, query),
        ArrowRight
      );
      return conversations.length
        ? [...found, { name: "Conversations", items: conversations }]
        : found;
    }
    const items = tabItems(all, tab, query, usage, now).slice(0, TAB_LIMIT);
    if (q) return [{ name: "", items }];
    // Without a query, a long tab reads better under its own headings.
    const groups: Section[] = [];
    for (const c of items) {
      let g = groups.find((x) => x.name === c.group);
      if (!g) groups.push((g = { name: c.group, items: [] }));
      g.items.push(c);
    }
    return groups;
  }, [all, tab, q, query, usage, now, picker, conversations]);
  const results = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // A new tab starts at its top.
  const [shownTab, setShownTab] = useState(tab);
  if (shownTab !== tab) {
    setShownTab(tab);
    setActive(null);
  }
  // A switcher opens on the chat before this one, so Enter flips back to it.
  const flipBack =
    tab === "sessions" && !q && !picker && results[0]?.hint === CURRENT;
  const highlighted = Math.min(
    active ?? (flipBack ? 1 : 0),
    Math.max(results.length - 1, 0)
  );

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const goTo = (next: PaletteTab) => {
    setPrefixTab(null);
    paletteActions.setTab(next, query);
  };

  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    if (c.keepOpen) return c.run();
    if (!picker && !c.id.startsWith("conversation:")) setUsage(noteUse(c.id));
    paletteActions.setOpen(false);
    // After the dialog lets go of focus, so what it opens can take it.
    setTimeout(() => c.run(), 0);
  };

  const onChange = (value: string) => {
    const prefix = !picker && !query ? parsePrefix(value) : null;
    setActive(null);
    if (prefix) {
      setQuery(prefix.text);
      setPrefixTab(prefix.tab);
      paletteActions.setTab(prefix.tab, prefix.text);
    } else setQuery(value);
  };

  return (
    <>
      <div className="border-foreground/[0.06] flex items-center gap-2 border-b px-3">
        <Search className="text-muted-foreground h-4 w-4 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = results.length || 1;
              setActive(
                (highlighted + (e.key === "ArrowDown" ? 1 : -1) + n) % n
              );
            } else if (e.key === "Tab" && !picker) {
              e.preventDefault();
              goTo(cycleTab(tab, e.shiftKey ? -1 : 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[highlighted]);
            } else if (
              e.key === "Backspace" &&
              !query &&
              prefixTab &&
              tab === prefixTab
            ) {
              e.preventDefault();
              goTo("all");
            } else if (
              picker &&
              (e.metaKey || e.ctrlKey) &&
              /^[1-9]$/.test(e.key)
            ) {
              e.preventDefault();
              run(picker.items[Number(e.key) - 1]);
            }
          }}
          placeholder={picker?.placeholder ?? PLACEHOLDER[tab]}
          aria-label={picker?.placeholder ?? PLACEHOLDER[tab].replace("…", "")}
          className="placeholder:text-muted-foreground h-12 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
        />
        <kbd className="text-muted-foreground hidden font-mono text-[10px] sm:inline">
          esc
        </kbd>
      </div>
      {!picker && <PaletteTabs tab={tab} onSelect={goTo} />}
      <div
        ref={listRef}
        role="listbox"
        aria-labelledby={picker ? undefined : `palette-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
      >
        {results.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Nothing matches.
          </p>
        )}
        <PaletteRows
          sections={sections}
          highlighted={highlighted}
          onHover={setActive}
          onRun={run}
        />
      </div>
    </>
  );
}
