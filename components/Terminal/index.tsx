'use client';

import { useRef, forwardRef, useImperativeHandle, useCallback, useState, useMemo, useEffect } from 'react';
import { useTheme } from 'next-themes';
import '@xterm/xterm/css/xterm.css';
import { ImagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SearchBar } from './SearchBar';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { TerminalToolbar } from './TerminalToolbar';
import { useTerminalConnection, useTerminalSearch } from './hooks';
import type { TerminalScrollState } from './hooks';
import { useViewport } from '@/hooks/useViewport';
import { ImagePicker } from '@/components/ImagePicker';

export type { TerminalScrollState };

export interface TerminalHandle {
  sendCommand: (command: string) => void;
  sendInput: (data: string) => void;
  focus: () => void;
  getScrollState: () => TerminalScrollState | null;
  restoreScrollState: (state: TerminalScrollState) => void;
}

interface TerminalProps {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onBeforeUnmount?: (scrollState: TerminalScrollState) => void;
  initialScrollState?: TerminalScrollState;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { onConnected, onDisconnected, onBeforeUnmount, initialScrollState },
  ref
) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isMobile } = useViewport();
  const { theme: currentTheme, resolvedTheme } = useTheme();
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [selectMode, setSelectMode] = useState(false);

  // Use the full theme string (e.g., "dark-purple") for terminal theming
  const terminalTheme = useMemo(() => {
    // For system theme, use the resolved theme
    if (currentTheme === 'system') {
      return resolvedTheme || 'dark';
    }
    return currentTheme || 'dark';
  }, [currentTheme, resolvedTheme]);

  const {
    connectionState,
    isAtBottom,
    xtermRef,
    searchAddonRef,
    scrollToBottom,
    copySelection,
    sendInput,
    sendCommand,
    focus,
    getScrollState,
    restoreScrollState,
  } = useTerminalConnection({
    terminalRef,
    onConnected,
    onDisconnected,
    onBeforeUnmount,
    initialScrollState,
    isMobile,
    theme: terminalTheme,
  });

  const {
    searchVisible,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    closeSearch,
    findNext,
    findPrevious,
  } = useTerminalSearch(searchAddonRef, xtermRef);

  // Handle image selection - paste file path into terminal
  const handleImageSelect = useCallback((filePath: string) => {
    sendInput(filePath);
    setShowImagePicker(false);
    focus();
  }, [sendInput, focus]);

  // Handle keyboard input from virtual keyboard
  const handleKeyboardInput = useCallback((key: string) => {
    sendInput(key);
  }, [sendInput]);

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    sendCommand,
    sendInput,
    focus,
    getScrollState,
    restoreScrollState,
  }));

  // Track visual viewport for iOS keyboard
  // We use explicit height instead of fixed positioning to stay in document flow
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    // Track the initial full height to detect keyboard
    const fullHeight = window.innerHeight;

    const updateViewport = () => {
      // Calculate how much space the keyboard is taking
      const currentHeight = viewport.height;
      const kbHeight = Math.max(0, fullHeight - currentHeight - viewport.offsetTop);
      setKeyboardHeight(kbHeight);
    };

    // Initial measurement
    updateViewport();

    viewport.addEventListener('resize', updateViewport);
    viewport.addEventListener('scroll', updateViewport);

    return () => {
      viewport.removeEventListener('resize', updateViewport);
      viewport.removeEventListener('scroll', updateViewport);
    };
  }, [isMobile]);

  // Toggle text selection mode for copying
  useEffect(() => {
    if (!terminalRef.current) return;

    const xtermScreen = terminalRef.current.querySelector('.xterm-screen') as HTMLElement;
    if (!xtermScreen) return;

    if (selectMode) {
      // Enable text selection
      xtermScreen.style.touchAction = 'auto';
      xtermScreen.style.userSelect = 'text';
      (xtermScreen.style as unknown as { webkitUserSelect: string }).webkitUserSelect = 'text';
    } else {
      // Disable text selection (restore defaults)
      xtermScreen.style.touchAction = 'none';
      xtermScreen.style.userSelect = 'none';
      (xtermScreen.style as unknown as { webkitUserSelect: string }).webkitUserSelect = 'none';
      // Clear any selection when exiting select mode
      xtermRef.current?.clearSelection();
    }
  }, [selectMode, xtermRef]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col overflow-hidden bg-background"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        // On mobile, shrink container when keyboard is open
        paddingBottom: isMobile && keyboardHeight > 0 ? keyboardHeight : undefined,
      }}
    >
      {/* Search Bar */}
      <SearchBar
        ref={searchInputRef}
        visible={searchVisible}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onFindNext={findNext}
        onFindPrevious={findPrevious}
        onClose={closeSearch}
      />

      {/* Terminal container - NO padding! FitAddon reads offsetHeight which includes padding */}
      <div
        ref={terminalRef}
        className={cn(
          "terminal-container min-h-0 w-full flex-1 overflow-hidden",
          selectMode && "select-mode"
        )}
        onClick={focus}
      />

      {/* Image picker button - desktop only (mobile uses virtual keyboard) */}
      {!isMobile && (
        <button
          onClick={() => setShowImagePicker(true)}
          className="absolute right-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-full bg-secondary shadow-lg transition-all hover:bg-accent"
          title="Select image"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
      )}

      {/* Image picker modal */}
      {showImagePicker && (
        <ImagePicker
          initialPath="~"
          onSelect={handleImageSelect}
          onClose={() => setShowImagePicker(false)}
        />
      )}

      {/* Scroll to bottom button */}
      <ScrollToBottomButton visible={!isAtBottom} onClick={scrollToBottom} />

      {/* Mobile: Toolbar with special keys (native keyboard handles text) */}
      {isMobile && (
        <TerminalToolbar
          onKeyPress={handleKeyboardInput}
          onImagePicker={() => setShowImagePicker(true)}
          onCopy={copySelection}
          selectMode={selectMode}
          onSelectModeChange={setSelectMode}
          visible={true}
        />
      )}

      {/* Connection status indicator (subtle) */}
      {connectionState === 'reconnecting' && (
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-400">
          <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          Reconnecting...
        </div>
      )}
    </div>
  );
});
