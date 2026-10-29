"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import { MIN_QUERY, useConversationSearch } from "@/data/search";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import { useViewport } from "@/hooks/useViewport";
import { cycleTab } from "@/lib/palette/tabs";
import { paletteActions, paletteUi } from "@/stores/palette";
import { PaletteTabs } from "../PaletteTabs";
import { NoResults, Recent, Skeleton } from "./EmptyState";
import { Preview } from "./Preview";
import { ResultList, flatten } from "./ResultList";
import { loadRecent, saveRecent, withRecent } from "./recent";
import { useOpenHit } from "./useOpenHit";

// ⌘K's Conversations tab: what was said in any chat, found as you type. Results on
// the left, the selected message in its conversation on the right; a phone
// shows the list, and a tap shows the message.
export function ConversationSearch() {
  const { query: seed } = useSnapshot(paletteUi);
  const { isMobile } = useViewport();
  const { workspace } = useSelectedWorkspace();
  const [text, setText] = useState(seed);
  const [all, setAll] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const [active, setActive] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const open = useOpenHit();

  const q = useDebouncedValue(text.trim(), 150);
  const scope = all || !workspace ? "all" : workspace.id;
  const searching = q.length >= MIN_QUERY;
  const { data, isPending, isFetching, isError } = useConversationSearch(
    q,
    scope,
    { enabled: searching }
  );
  const groups = useMemo(
    () => (searching ? (data?.groups ?? []) : []),
    [searching, data]
  );
  const hits = useMemo(() => flatten(groups), [groups]);
  const highlighted = Math.min(active, Math.max(hits.length - 1, 0));
  const current = hits[highlighted];
  // The text typed is ahead of the results shown while the debounce runs.
  const stale = text.trim() !== q || (searching && isFetching);

  // New results start at the top.
  const [shown, setShown] = useState(data);
  if (shown !== data) {
    setShown(data);
    setActive(0);
  }
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const openHit = (i: number) => {
    const h = hits[i];
    if (!h) return;
    saveRecent(withRecent(recent, text));
    open(h.group, h.hit);
  };
  const pick = (i: number) => {
    setActive(i);
    if (isMobile) setPreviewing(true);
    else openHit(i);
  };

  const showPreview = !!current && (!isMobile || previewing);
  const showList = !isMobile || !previewing;

  return (
    <>
      {showList && (
        <div className="border-foreground/[0.06] flex flex-col border-b">
          <div className="flex items-center gap-2 px-3">
            <Search className="text-muted-foreground h-4 w-4 shrink-0" />
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const n = hits.length || 1;
                  setActive(
                    (highlighted + (e.key === "ArrowDown" ? 1 : -1) + n) % n
                  );
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  openHit(highlighted);
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  paletteActions.setTab(
                    cycleTab("conversations", e.shiftKey ? -1 : 1),
                    text
                  );
                }
              }}
              placeholder="Search every conversation…"
              aria-label="Search every conversation"
              className="placeholder:text-muted-foreground h-12 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
            />
            {stale && searching && (
              <Loader2 className="text-muted-foreground h-3.5 w-3.5 shrink-0 animate-spin" />
            )}
            <kbd className="text-muted-foreground hidden font-mono text-[10px] sm:inline">
              esc
            </kbd>
          </div>
          <PaletteTabs
            tab="conversations"
            onSelect={(tab) => paletteActions.setTab(tab, text)}
          />
          {workspace && (
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="flex overflow-hidden rounded-md border text-xs">
                {(
                  [
                    [false, workspace.name],
                    [true, "All workspaces"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={String(value)}
                    type="button"
                    aria-pressed={all === value}
                    onClick={() => setAll(value)}
                    className={cn(
                      "h-8 max-w-40 truncate px-3 md:h-7",
                      all === value
                        ? "bg-primary/10 text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {showList && (
          <div
            ref={listRef}
            role="listbox"
            aria-label="Matches"
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5",
              current &&
                "md:border-foreground/[0.06] md:flex-none md:basis-[44%] md:border-r"
            )}
          >
            {data?.indexing != null && (
              <p className="bg-muted/50 text-muted-foreground mx-1 mt-1 rounded-lg px-3 py-2 text-xs">
                Still indexing older conversations (
                {Math.round(data.indexing * 100)}%). Results fill in as it goes.
              </p>
            )}
            {!searching && (
              <Recent
                items={recent}
                onPick={setText}
                onClear={() => {
                  saveRecent([]);
                  setRecent([]);
                }}
              />
            )}
            {searching && isPending && <Skeleton />}
            {searching && isError && (
              <p className="text-muted-foreground px-4 py-10 text-center text-sm">
                Search isn’t answering. Try again in a moment.
              </p>
            )}
            {searching &&
              !isPending &&
              !isError &&
              hits.length === 0 &&
              !stale && (
                <NoResults
                  query={q}
                  scoped={scope !== "all"}
                  onWiden={() => setAll(true)}
                />
              )}
            <div className={cn(stale && "opacity-60 transition-opacity")}>
              <ResultList
                groups={groups}
                active={highlighted}
                onActive={setActive}
                onPick={pick}
              />
            </div>
            {data?.more && (
              <p className="text-muted-foreground px-3 py-3 text-center text-xs">
                Showing the best matches. Add a word to narrow it down.
              </p>
            )}
          </div>
        )}
        {showPreview && current && (
          <div className="flex min-w-0 flex-1 flex-col">
            <Preview
              key={`${current.group.sessionId}:${current.hit.itemId}`}
              group={current.group}
              itemId={current.hit.itemId}
              terms={data?.terms ?? []}
              onOpen={() => openHit(highlighted)}
              onBack={isMobile ? () => setPreviewing(false) : undefined}
            />
          </div>
        )}
      </div>
      <div className="border-foreground/[0.06] text-muted-foreground flex items-center gap-4 border-t px-3 py-2 text-[11px]">
        <span className="hidden gap-4 sm:flex">
          <span>
            <kbd className="font-mono">↑↓</kbd> move
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span>
            <kbd className="font-mono">tab</kbd> next tab
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
        </span>
        <span className="ml-auto font-mono">
          {searching && data
            ? `${groups.length} ${groups.length === 1 ? "chat" : "chats"} · ${data.tookMs} ms`
            : ""}
        </span>
      </div>
    </>
  );
}
