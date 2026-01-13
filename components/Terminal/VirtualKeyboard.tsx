'use client';

import { useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ImagePlus, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useKeyRepeat } from '@/hooks/useKeyRepeat';

// ANSI escape sequences
const SPECIAL_KEYS = {
  UP: '\x1b[A',
  DOWN: '\x1b[B',
  LEFT: '\x1b[D',
  RIGHT: '\x1b[C',
  ENTER: '\r',
  ESC: '\x1b',
  TAB: '\t',
  BACKSPACE: '\x7f',
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  CTRL_Z: '\x1a',
  CTRL_L: '\x0c',
} as const;

// Keyboard layouts
const ROWS = {
  numbers: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  numbersShift: ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
  row1: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  row2: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  row3: ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  symbols: ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  symbolsMore: ['.', ',', '?', '!', "'", '`', '~', '=', '+', '*'],
};

type KeyboardMode = 'quick' | 'abc' | 'num';

interface VirtualKeyboardProps {
  onKeyPress: (key: string) => void;
  onImagePick?: () => void;
  visible?: boolean;
}

interface KeyProps {
  char: string;
  onPress: () => void;
  className?: string;
}

// Trigger haptic feedback if available
function haptic() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(5);
  }
}

function Key({ char, onPress, className }: KeyProps) {
  return (
    <button
      onClick={() => { haptic(); onPress(); }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'flex h-[44px] flex-1 touch-manipulation items-center justify-center rounded-md text-sm font-medium',
        'bg-secondary text-secondary-foreground',
        'active:bg-primary active:text-primary-foreground active:scale-110 active:z-10',
        'transition-transform duration-75',
        'select-none min-w-[32px]',
        className
      )}
    >
      {char}
    </button>
  );
}

// Terminal shortcuts bar - common keys for terminal interaction
function TerminalShortcutsBar({
  onKeyPress,
  isListening,
  onMicToggle,
  isMicSupported,
}: {
  onKeyPress: (key: string) => void;
  isListening?: boolean;
  onMicToggle?: () => void;
  isMicSupported?: boolean;
}) {
  const shortcuts = [
    { label: 'Esc', key: SPECIAL_KEYS.ESC },
    { label: '^C', key: SPECIAL_KEYS.CTRL_C, highlight: true },
    { label: 'Tab', key: SPECIAL_KEYS.TAB },
    { label: '^D', key: SPECIAL_KEYS.CTRL_D },
    { label: '^Z', key: SPECIAL_KEYS.CTRL_Z },
    { label: '^L', key: SPECIAL_KEYS.CTRL_L },
    { label: '↑', key: SPECIAL_KEYS.UP },
    { label: '↓', key: SPECIAL_KEYS.DOWN },
  ];

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-none">
      {/* Mic button - always visible when supported */}
      {isMicSupported && onMicToggle && (
        <button
          onClick={() => { haptic(); onMicToggle(); }}
          className={cn(
            "flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            "active:scale-105",
            isListening
              ? "bg-red-500 text-white animate-pulse"
              : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
          )}
        >
          {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      )}
      {shortcuts.map((shortcut) => (
        <button
          key={shortcut.label}
          onClick={() => { haptic(); onKeyPress(shortcut.key); }}
          className={cn(
            "flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            "active:bg-primary active:text-primary-foreground active:scale-105",
            shortcut.highlight
              ? "bg-red-500/20 text-red-500"
              : "bg-secondary text-secondary-foreground"
          )}
        >
          {shortcut.label}
        </button>
      ))}
    </div>
  );
}

export function VirtualKeyboard({
  onKeyPress,
  onImagePick,
  visible = true,
}: VirtualKeyboardProps) {
  const [mode, setMode] = useState<KeyboardMode>('abc');
  const [shifted, setShifted] = useState(false);

  // Speech recognition - send transcript directly to terminal
  const handleTranscript = useCallback((text: string) => {
    // Send each character individually to the terminal
    for (const char of text) {
      onKeyPress(char);
    }
  }, [onKeyPress]);

  const { isListening, isSupported: isMicSupported, toggle: toggleMic } = useSpeechRecognition(handleTranscript);

  // Key repeat for backspace
  const handleBackspace = useCallback(() => {
    onKeyPress(SPECIAL_KEYS.BACKSPACE);
  }, [onKeyPress]);
  const { startRepeat: startBackspace, stopRepeat: stopBackspace } = useKeyRepeat(handleBackspace);

  if (!visible) return null;

  const handleKey = (key: string) => {
    onKeyPress(shifted ? key.toUpperCase() : key);
    if (shifted) setShifted(false);
  };

  // Quick mode - just essential terminal keys
  if (mode === 'quick') {
    return (
      <div
        className="flex flex-col bg-background select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Terminal shortcuts */}
        <TerminalShortcutsBar onKeyPress={onKeyPress} isListening={isListening} onMicToggle={toggleMic} isMicSupported={isMicSupported} />

        <div className="flex flex-col gap-1.5 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {/* Mode tabs + common keys */}
          <div className="flex gap-1.5">
            <button
              onClick={() => { haptic(); setMode('abc'); }}
              className="flex h-[44px] flex-1 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
            >
              ABC
            </button>
            <button
              onClick={() => { haptic(); setMode('num'); }}
              className="flex h-[44px] flex-1 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
            >
              123
            </button>
            {onImagePick && (
              <button
                onClick={() => { haptic(); onImagePick(); }}
                className="flex h-[44px] w-[44px] items-center justify-center rounded-md bg-muted text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
              >
                <ImagePlus className="h-5 w-5" />
              </button>
            )}
            <div className="flex-1" />
            <button
              onTouchStart={startBackspace}
              onTouchEnd={stopBackspace}
              onTouchCancel={stopBackspace}
              onMouseDown={startBackspace}
              onMouseUp={stopBackspace}
              onMouseLeave={stopBackspace}
              className="flex h-[44px] w-[56px] items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground active:bg-primary active:text-primary-foreground transition-transform duration-75"
            >
              ⌫
            </button>
          </div>

          {/* Arrow keys + Enter */}
          <div className="flex gap-1.5">
            <button
              onClick={() => { haptic(); onKeyPress(SPECIAL_KEYS.LEFT); }}
              className="flex h-[44px] w-[44px] items-center justify-center rounded-md bg-muted text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => { haptic(); onKeyPress(SPECIAL_KEYS.UP); }}
                className="flex h-[20px] w-[44px] items-center justify-center rounded-md bg-muted text-muted-foreground active:bg-primary active:text-primary-foreground transition-colors duration-75"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => { haptic(); onKeyPress(SPECIAL_KEYS.DOWN); }}
                className="flex h-[20px] w-[44px] items-center justify-center rounded-md bg-muted text-muted-foreground active:bg-primary active:text-primary-foreground transition-colors duration-75"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => { haptic(); onKeyPress(SPECIAL_KEYS.RIGHT); }}
              className="flex h-[44px] w-[44px] items-center justify-center rounded-md bg-muted text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            <div className="flex-1" />
            <Key char="⏎" onPress={() => onKeyPress(SPECIAL_KEYS.ENTER)} className="bg-primary/30 text-primary w-[68px]" />
          </div>
        </div>
      </div>
    );
  }

  // ABC mode - full QWERTY
  if (mode === 'abc') {
    return (
      <div
        className="flex flex-col bg-background select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Terminal shortcuts */}
        <TerminalShortcutsBar onKeyPress={onKeyPress} isListening={isListening} onMicToggle={toggleMic} isMicSupported={isMicSupported} />

        <div className="flex flex-col gap-1.5 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {/* QWERTY rows */}
          <div className="flex gap-1">
            {ROWS.row1.map((char) => (
              <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
            ))}
          </div>
          <div className="flex gap-1 px-4">
            {ROWS.row2.map((char) => (
              <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
            ))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => { haptic(); setShifted(!shifted); }}
              className={cn(
                'flex h-[44px] w-[48px] items-center justify-center rounded-md text-sm font-medium active:scale-105 transition-transform duration-75',
                shifted ? 'bg-primary/30 text-primary active:bg-primary active:text-primary-foreground' : 'bg-muted text-muted-foreground active:bg-primary active:text-primary-foreground'
              )}
            >
              ⇧
            </button>
            {ROWS.row3.map((char) => (
              <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
            ))}
            <button
              onTouchStart={startBackspace}
              onTouchEnd={stopBackspace}
              onTouchCancel={stopBackspace}
              onMouseDown={startBackspace}
              onMouseUp={stopBackspace}
              onMouseLeave={stopBackspace}
              className="flex h-[44px] w-[48px] items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground active:bg-primary active:text-primary-foreground transition-transform duration-75"
            >
              ⌫
            </button>
          </div>

          {/* Bottom row */}
          <div className="flex gap-1">
            <button
              onClick={() => { haptic(); setMode('quick'); }}
              className="flex h-[44px] w-[56px] items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
            >
              ^C
            </button>
            <button
              onClick={() => { haptic(); setMode('num'); }}
              className="flex h-[44px] w-[48px] items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
            >
              123
            </button>
            <button
              onClick={() => { haptic(); onKeyPress(' '); }}
              className="flex h-[44px] flex-1 items-center justify-center rounded-md bg-secondary text-sm text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-[1.02] transition-transform duration-75"
            >
              space
            </button>
            <button
              onClick={() => { haptic(); onKeyPress(SPECIAL_KEYS.ENTER); }}
              className="flex h-[44px] w-[68px] items-center justify-center rounded-md bg-primary/30 text-sm font-medium text-primary active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
            >
              ⏎
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Num mode - numbers and symbols
  return (
    <div
      className="flex flex-col bg-background select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Terminal shortcuts */}
      <TerminalShortcutsBar onKeyPress={onKeyPress} isListening={isListening} onMicToggle={toggleMic} isMicSupported={isMicSupported} />

      <div className="flex flex-col gap-1.5 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {/* Number row */}
        <div className="flex gap-1">
          {ROWS.numbers.map((char) => (
            <Key key={char} char={char} onPress={() => onKeyPress(char)} />
          ))}
        </div>

        {/* Symbols rows */}
        <div className="flex gap-1">
          {ROWS.symbols.map((char) => (
            <Key key={char} char={char} onPress={() => onKeyPress(char)} />
          ))}
        </div>
        <div className="flex gap-1">
          {ROWS.symbolsMore.map((char) => (
            <Key key={char} char={char} onPress={() => onKeyPress(char)} />
          ))}
        </div>

        {/* Bottom row */}
        <div className="flex gap-1">
          <button
            onClick={() => { haptic(); setMode('quick'); }}
            className="flex h-[44px] w-[56px] items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
          >
            ^C
          </button>
          <button
            onClick={() => { haptic(); setMode('abc'); }}
            className="flex h-[44px] w-[48px] items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
          >
            ABC
          </button>
          <button
            onClick={() => { haptic(); onKeyPress(' '); }}
            className="flex h-[44px] flex-1 items-center justify-center rounded-md bg-secondary text-sm text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-[1.02] transition-transform duration-75"
          >
            space
          </button>
          <button
            onTouchStart={startBackspace}
            onTouchEnd={stopBackspace}
            onTouchCancel={stopBackspace}
            onMouseDown={startBackspace}
            onMouseUp={stopBackspace}
            onMouseLeave={stopBackspace}
            className="flex h-[44px] w-[48px] items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground active:bg-primary active:text-primary-foreground transition-transform duration-75"
          >
            ⌫
          </button>
          <button
            onClick={() => { haptic(); onKeyPress(SPECIAL_KEYS.ENTER); }}
            className="flex h-[44px] w-[68px] items-center justify-center rounded-md bg-primary/30 text-sm font-medium text-primary active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
          >
            ⏎
          </button>
        </div>
      </div>
    </div>
  );
}
