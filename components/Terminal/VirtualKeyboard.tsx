'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ImagePlus } from 'lucide-react';
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
}

interface KeyProps {
  char: string;
  onPress: () => void;
  className?: string;
}

function Key({ char, onPress, className }: KeyProps) {
  return (
    <button
      onClick={onPress}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'flex h-[38px] flex-1 touch-manipulation items-center justify-center rounded-md text-sm font-medium',
        'bg-zinc-800 text-zinc-200 active:bg-zinc-600',
        'select-none',
        className
      )}
    >
      {char}
    </button>
  );
}

export function VirtualKeyboard({ onKeyPress, onImagePick, visible = true }: VirtualKeyboardProps) {
  const [mode, setMode] = useState<KeyboardMode>('abc');
  const [shifted, setShifted] = useState(false);

  if (!visible) return null;

  const handleKey = (key: string) => {
    onKeyPress(shifted ? key.toUpperCase() : key);
    if (shifted) setShifted(false);
  };

  // Quick mode - just essential terminal keys
  if (mode === 'quick') {
    return (
      <div
        className="flex flex-col gap-1 border-t border-zinc-800 bg-zinc-900/98 px-1.5 py-1.5 backdrop-blur-sm select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Mode tabs + common keys */}
        <div className="flex gap-1">
          <button
            onClick={() => setMode('abc')}
            className="flex h-[38px] flex-1 items-center justify-center rounded-md bg-zinc-700 text-xs font-medium text-zinc-300 active:bg-zinc-500"
          >
            ABC
          </button>
          <button
            onClick={() => setMode('num')}
            className="flex h-[38px] flex-1 items-center justify-center rounded-md bg-zinc-700 text-xs font-medium text-zinc-300 active:bg-zinc-500"
          >
            123
          </button>
          <Key char="Tab" onPress={() => onKeyPress(SPECIAL_KEYS.TAB)} className="bg-zinc-700" />
          <Key char="Esc" onPress={() => onKeyPress(SPECIAL_KEYS.ESC)} className="bg-zinc-700" />
          <Key char="⌫" onPress={() => onKeyPress(SPECIAL_KEYS.BACKSPACE)} className="bg-zinc-700" />
        </div>

        {/* Arrow keys + Enter + Ctrl shortcuts */}
        <div className="flex gap-1">
          <Key char="^C" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_C)} className="bg-red-900/40 text-red-400" />
          {onImagePick && (
            <button
              onClick={onImagePick}
              className="flex h-[38px] w-[38px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
          )}
          <Key char="^D" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_D)} className="bg-zinc-700" />
          <Key char="^Z" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_Z)} className="bg-zinc-700" />
          <div className="flex-1" />
          <button
            onClick={() => onKeyPress(SPECIAL_KEYS.LEFT)}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => onKeyPress(SPECIAL_KEYS.UP)}
              className="flex h-[18px] w-[38px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => onKeyPress(SPECIAL_KEYS.DOWN)}
              className="flex h-[18px] w-[38px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => onKeyPress(SPECIAL_KEYS.RIGHT)}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <Key char="⏎" onPress={() => onKeyPress(SPECIAL_KEYS.ENTER)} className="bg-primary/30 text-primary" />
        </div>
      </div>
    );
  }

  // ABC mode - full QWERTY
  if (mode === 'abc') {
    return (
      <div
        className="flex flex-col gap-1 border-t border-zinc-800 bg-zinc-900/98 px-1.5 py-1.5 backdrop-blur-sm select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* QWERTY rows */}
        <div className="flex gap-0.5">
          {ROWS.row1.map((char) => (
            <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
          ))}
        </div>
        <div className="flex gap-0.5 px-3">
          {ROWS.row2.map((char) => (
            <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
          ))}
        </div>
        <div className="flex gap-0.5">
          <button
            onClick={() => setShifted(!shifted)}
            className={cn(
              'flex h-[38px] w-[42px] items-center justify-center rounded-md text-sm font-medium active:bg-zinc-500',
              shifted ? 'bg-primary/30 text-primary' : 'bg-zinc-700 text-zinc-300'
            )}
          >
            ⇧
          </button>
          {ROWS.row3.map((char) => (
            <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
          ))}
          <button
            onClick={() => onKeyPress(SPECIAL_KEYS.BACKSPACE)}
            className="flex h-[38px] w-[42px] items-center justify-center rounded-md bg-zinc-700 text-sm font-medium text-zinc-300 active:bg-zinc-500"
          >
            ⌫
          </button>
        </div>

        {/* Bottom row */}
        <div className="flex gap-0.5">
          <button
            onClick={() => setMode('quick')}
            className="flex h-[38px] w-[50px] items-center justify-center rounded-md bg-zinc-700 text-xs font-medium text-zinc-300 active:bg-zinc-500"
          >
            ^C
          </button>
          <button
            onClick={() => setMode('num')}
            className="flex h-[38px] w-[42px] items-center justify-center rounded-md bg-zinc-700 text-xs font-medium text-zinc-300 active:bg-zinc-500"
          >
            123
          </button>
          <button
            onClick={() => onKeyPress(' ')}
            className="flex h-[38px] flex-1 items-center justify-center rounded-md bg-zinc-800 text-sm text-zinc-400 active:bg-zinc-600"
          >
            space
          </button>
          <button
            onClick={() => onKeyPress(SPECIAL_KEYS.ENTER)}
            className="flex h-[38px] w-[60px] items-center justify-center rounded-md bg-primary/30 text-sm font-medium text-primary active:bg-primary/50"
          >
            ⏎
          </button>
        </div>
      </div>
    );
  }

  // Num mode - numbers and symbols
  return (
    <div
      className="flex flex-col gap-1 border-t border-zinc-800 bg-zinc-900/98 px-1.5 py-1.5 backdrop-blur-sm select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Number row */}
      <div className="flex gap-0.5">
        {ROWS.numbers.map((char) => (
          <Key key={char} char={char} onPress={() => onKeyPress(char)} />
        ))}
      </div>

      {/* Symbols rows */}
      <div className="flex gap-0.5">
        {ROWS.symbols.map((char) => (
          <Key key={char} char={char} onPress={() => onKeyPress(char)} />
        ))}
      </div>
      <div className="flex gap-0.5">
        {ROWS.symbolsMore.map((char) => (
          <Key key={char} char={char} onPress={() => onKeyPress(char)} />
        ))}
      </div>

      {/* Bottom row */}
      <div className="flex gap-0.5">
        <button
          onClick={() => setMode('quick')}
          className="flex h-[38px] w-[50px] items-center justify-center rounded-md bg-zinc-700 text-xs font-medium text-zinc-300 active:bg-zinc-500"
        >
          ^C
        </button>
        <button
          onClick={() => setMode('abc')}
          className="flex h-[38px] w-[42px] items-center justify-center rounded-md bg-zinc-700 text-xs font-medium text-zinc-300 active:bg-zinc-500"
        >
          ABC
        </button>
        <button
          onClick={() => onKeyPress(' ')}
          className="flex h-[38px] flex-1 items-center justify-center rounded-md bg-zinc-800 text-sm text-zinc-400 active:bg-zinc-600"
        >
          space
        </button>
        <button
          onClick={() => onKeyPress(SPECIAL_KEYS.BACKSPACE)}
          className="flex h-[38px] w-[42px] items-center justify-center rounded-md bg-zinc-700 text-sm font-medium text-zinc-300 active:bg-zinc-500"
        >
          ⌫
        </button>
        <button
          onClick={() => onKeyPress(SPECIAL_KEYS.ENTER)}
          className="flex h-[38px] w-[60px] items-center justify-center rounded-md bg-primary/30 text-sm font-medium text-primary active:bg-primary/50"
        >
          ⏎
        </button>
      </div>
    </div>
  );
}
