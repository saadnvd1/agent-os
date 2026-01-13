'use client';

import { useRef, forwardRef, useImperativeHandle, useCallback, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { ImagePlus } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { VirtualKeyboard } from './VirtualKeyboard';
import { KeybarToggleButton } from './KeybarToggleButton';
import { useTerminalConnection, useTerminalSearch } from './hooks';
import type { TerminalScrollState } from './hooks';
import { useKeybarVisibility } from '@/hooks/useKeybarVisibility';
import { useViewport } from '@/hooks/useViewport';
import { cn } from '@/lib/utils';
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
  const { isVisible: keybarVisible, toggle: toggleKeybar, show: showKeybar } = useKeybarVisibility();
  const { isMobile } = useViewport();
  const [showImagePicker, setShowImagePicker] = useState(false);

  const {
    connectionState,
    isAtBottom,
    xtermRef,
    searchAddonRef,
    scrollToBottom,
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

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    sendCommand,
    sendInput,
    focus,
    getScrollState,
    restoreScrollState,
  }));

  // NOTE: We intentionally do NOT resize the terminal when keybar visibility changes.
  // Resizing causes xterm to recalculate rows which scrolls the viewport.
  // The flex container handles the visual shrink/grow - xterm just clips at the bottom.

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
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
      {/* touch-action: none is CRITICAL for mobile - prevents browser from intercepting touch events */}
      <div
        ref={terminalRef}
        className="min-h-0 w-full flex-1 overflow-hidden bg-zinc-950"
        style={isMobile ? { touchAction: 'none' } : undefined}
        onClick={isMobile ? showKeybar : undefined}
      />

      {/* Image picker button */}
      <button
        onClick={() => setShowImagePicker(true)}
        className={cn(
          "absolute z-40 flex items-center justify-center rounded-full bg-zinc-800 shadow-lg transition-all hover:bg-zinc-700",
          "h-9 w-9",
          isMobile
            ? "bottom-2 right-2"  // Mobile: bottom right
            : "right-3 top-3",     // Desktop: top right
          keybarVisible && isMobile && "bottom-[140px]" // Shift up when keyboard visible
        )}
        title="Select image"
      >
        <ImagePlus className="h-4 w-4" />
      </button>

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

      {/* Mobile: Keybar toggle button and virtual keyboard */}
      {isMobile && (
        <>
          <KeybarToggleButton isVisible={keybarVisible} onToggle={toggleKeybar} />
          <VirtualKeyboard onKeyPress={sendInput} visible={keybarVisible} />
        </>
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
