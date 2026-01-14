"use client";

import { forwardRef } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  visible: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  (
    { visible, query, onQueryChange, onFindNext, onFindPrevious, onClose },
    ref
  ) => {
    if (!visible) return null;

    return (
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2",
          "bg-zinc-900/90 backdrop-blur-sm",
          "border-b border-zinc-800"
        )}
      >
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          ref={ref}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search in terminal..."
          className={cn(
            "flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500",
            "focus:outline-none"
          )}
        />
        <div className="flex items-center gap-1">
          <button
            onClick={onFindPrevious}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={onFindNext}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            title="Next (Enter)"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }
);

SearchBar.displayName = "SearchBar";
