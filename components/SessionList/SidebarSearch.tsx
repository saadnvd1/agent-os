"use client";

import { Search, X } from "lucide-react";
import { sidebarUiActions } from "@/stores/sidebarUi";

// Titles and project names. ⌘K lands here on desktop (app/page.tsx).
export function SidebarSearch({ query }: { query: string }) {
  return (
    <label className="bg-card text-muted-foreground focus-within:ring-primary/40 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 shadow-xs focus-within:ring-2 md:min-h-9">
      <Search className="h-3.5 w-3.5 shrink-0" />
      <input
        data-sidebar-search
        type="search"
        value={query}
        placeholder="Search"
        aria-label="Search sessions"
        onChange={(e) => sidebarUiActions.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            sidebarUiActions.setQuery("");
            e.currentTarget.blur();
          }
        }}
        className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => sidebarUiActions.setQuery("")}
          className="-mr-3 flex h-11 w-11 items-center justify-center md:h-7 md:w-7"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <kbd className="text-muted-foreground/60 hidden font-sans text-xs md:inline">
          ⌘K
        </kbd>
      )}
    </label>
  );
}
