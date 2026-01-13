'use client';

import { useState, useRef, useCallback } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ImagePlus, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  recentCommands?: string[];
  onCommandSelect?: (command: string) => void;
}

interface KeyProps {
  char: string;
  onPress: () => void;
  className?: string;
  showPreview?: boolean;
}

// Trigger haptic feedback if available
function haptic() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(5);
  }
}

// Key preview popup state
interface PreviewState {
  char: string;
  x: number;
  y: number;
}

function Key({ char, onPress, className, showPreview = true }: KeyProps) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!showPreview || !buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    setPreview({
      char,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, [char, showPreview]);

  const handleTouchEnd = useCallback(() => {
    setPreview(null);
    haptic();
    onPress();
  }, [onPress]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Only fire on non-touch devices (touch devices use touchend)
    if (e.detail === 0) return; // Triggered by touch
    haptic();
    onPress();
  }, [onPress]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => setPreview(null)}
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

      {/* Key preview popup */}
      {preview && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: preview.x,
            top: preview.y - 60,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="flex items-center justify-center w-12 h-14 rounded-lg bg-primary text-primary-foreground text-2xl font-semibold shadow-lg">
            {preview.char}
          </div>
          <div
            className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '8px solid hsl(var(--primary))',
            }}
          />
        </div>
      )}
    </>
  );
}

// Recent commands bar component
function RecentCommandsBar({
  commands,
  onSelect
}: {
  commands: string[];
  onSelect: (cmd: string) => void;
}) {
  if (!commands || commands.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 overflow-x-auto scrollbar-none">
      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      {commands.map((cmd, i) => (
        <button
          key={`${cmd}-${i}`}
          onClick={() => { haptic(); onSelect(cmd); }}
          className="flex-shrink-0 px-3 py-1.5 rounded-full bg-secondary text-xs text-secondary-foreground active:bg-primary active:text-primary-foreground transition-colors"
        >
          {cmd.length > 20 ? cmd.slice(0, 20) + '…' : cmd}
        </button>
      ))}
    </div>
  );
}

export function VirtualKeyboard({
  onKeyPress,
  onImagePick,
  visible = true,
  recentCommands = [],
  onCommandSelect,
}: VirtualKeyboardProps) {
  const [mode, setMode] = useState<KeyboardMode>('abc');
  const [shifted, setShifted] = useState(false);

  if (!visible) return null;

  const handleKey = (key: string) => {
    onKeyPress(shifted ? key.toUpperCase() : key);
    if (shifted) setShifted(false);
  };

  const handleCommandSelect = (cmd: string) => {
    if (onCommandSelect) {
      onCommandSelect(cmd);
    } else {
      // Default: type command and press enter
      onKeyPress(cmd);
      onKeyPress(SPECIAL_KEYS.ENTER);
    }
  };

  // Quick mode - just essential terminal keys
  if (mode === 'quick') {
    return (
      <div
        className="flex flex-col bg-background select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Recent commands */}
        <RecentCommandsBar commands={recentCommands} onSelect={handleCommandSelect} />

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
            <Key char="Tab" onPress={() => onKeyPress(SPECIAL_KEYS.TAB)} className="bg-muted" showPreview={false} />
            <Key char="Esc" onPress={() => onKeyPress(SPECIAL_KEYS.ESC)} className="bg-muted" showPreview={false} />
            <Key char="⌫" onPress={() => onKeyPress(SPECIAL_KEYS.BACKSPACE)} className="bg-muted" showPreview={false} />
          </div>

          {/* Arrow keys + Enter + Ctrl shortcuts */}
          <div className="flex gap-1.5">
            <Key char="^C" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_C)} className="bg-red-500/20 text-red-500" showPreview={false} />
            {onImagePick && (
              <button
                onClick={() => { haptic(); onImagePick(); }}
                className="flex h-[44px] w-[44px] items-center justify-center rounded-md bg-muted text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
              >
                <ImagePlus className="h-5 w-5" />
              </button>
            )}
            <Key char="^D" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_D)} className="bg-muted" showPreview={false} />
            <Key char="^Z" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_Z)} className="bg-muted" showPreview={false} />
            <div className="flex-1" />
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
            <Key char="⏎" onPress={() => onKeyPress(SPECIAL_KEYS.ENTER)} className="bg-primary/30 text-primary" showPreview={false} />
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
        {/* Recent commands */}
        <RecentCommandsBar commands={recentCommands} onSelect={handleCommandSelect} />

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
              onClick={() => { haptic(); onKeyPress(SPECIAL_KEYS.BACKSPACE); }}
              className="flex h-[44px] w-[48px] items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
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
      {/* Recent commands */}
      <RecentCommandsBar commands={recentCommands} onSelect={handleCommandSelect} />

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
            onClick={() => { haptic(); onKeyPress(SPECIAL_KEYS.BACKSPACE); }}
            className="flex h-[44px] w-[48px] items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground active:bg-primary active:text-primary-foreground active:scale-105 transition-transform duration-75"
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
