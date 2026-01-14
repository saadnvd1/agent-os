"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal as XTerm } from "@xterm/xterm";

export function useTerminalSearch(
  searchAddonRef: React.RefObject<SearchAddon | null>,
  xtermRef: React.RefObject<XTerm | null>
) {
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const findNext = useCallback(() => {
    if (searchAddonRef.current && searchQuery) {
      searchAddonRef.current.findNext(searchQuery, {
        regex: false,
        caseSensitive: false,
        incremental: true,
      });
    }
  }, [searchQuery, searchAddonRef]);

  const findPrevious = useCallback(() => {
    if (searchAddonRef.current && searchQuery) {
      searchAddonRef.current.findPrevious(searchQuery, {
        regex: false,
        caseSensitive: false,
      });
    }
  }, [searchQuery, searchAddonRef]);

  const closeSearch = useCallback(() => {
    setSearchVisible(false);
    setSearchQuery("");
    if (searchAddonRef.current) {
      searchAddonRef.current.clearDecorations();
    }
    xtermRef.current?.focus();
  }, [searchAddonRef, xtermRef]);

  const openSearch = useCallback(() => {
    setSearchVisible(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + F = Open search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "f") {
        e.preventDefault();
        openSearch();
      }
      // Escape = Close search
      if (e.key === "Escape" && searchVisible) {
        closeSearch();
      }
      // Enter in search = Find next
      if (
        e.key === "Enter" &&
        searchVisible &&
        document.activeElement === searchInputRef.current
      ) {
        e.preventDefault();
        if (e.shiftKey) {
          findPrevious();
        } else {
          findNext();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchVisible, findNext, findPrevious, closeSearch, openSearch]);

  // Auto-search when query changes
  useEffect(() => {
    if (searchQuery && searchAddonRef.current) {
      findNext();
    }
  }, [searchQuery, findNext, searchAddonRef]);

  return {
    searchVisible,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    openSearch,
    closeSearch,
    findNext,
    findPrevious,
    toggleSearch: () => {
      if (searchVisible) {
        closeSearch();
      } else {
        openSearch();
      }
    },
  };
}
