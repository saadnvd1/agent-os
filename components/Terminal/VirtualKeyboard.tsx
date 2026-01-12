'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Delete, Space, CornerDownLeft } from 'lucide-react';
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
  symbols1: ['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'],
  symbols2: ['_', '+', '{', '}', '|', ':', '"', '<', '>', '?'],
};

interface VirtualKeyboardProps {
  onKeyPress: (key: string) => void;
  visible?: boolean;
}

interface KeyProps {
  char: string;
  onPress: () => void;
  width?: 'normal' | 'wide' | 'wider' | 'space';
  variant?: 'default' | 'special' | 'action' | 'danger';
}

function Key({ char, onPress, width = 'normal', variant = 'default' }: KeyProps) {
  const widthClasses = {
    normal: 'min-w-[32px] flex-1',
    wide: 'min-w-[48px] px-2',
    wider: 'min-w-[64px] px-3',
    space: 'flex-[4]',
  };

  const variantClasses = {
    default: 'bg-zinc-800 text-zinc-200 active:bg-zinc-600',
    special: 'bg-zinc-700 text-zinc-300 active:bg-zinc-500',
    action: 'bg-primary/30 text-primary active:bg-primary/50',
    danger: 'bg-red-900/30 text-red-400 active:bg-red-800/50',
  };

  return (
    <button
      onClick={onPress}
      className={cn(
        'flex h-[42px] touch-manipulation items-center justify-center rounded-md text-sm font-medium transition-colors',
        widthClasses[width],
        variantClasses[variant]
      )}
    >
      {char}
    </button>
  );
}

export function VirtualKeyboard({ onKeyPress, visible = true }: VirtualKeyboardProps) {
  const [shifted, setShifted] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const [showCtrl, setShowCtrl] = useState(false);

  if (!visible) return null;

  const handleKey = (key: string) => {
    if (showCtrl) {
      // Send Ctrl+key
      const ctrlKey = String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
      onKeyPress(ctrlKey);
      setShowCtrl(false);
    } else {
      onKeyPress(shifted ? key.toUpperCase() : key);
      if (shifted) setShifted(false);
    }
  };

  const currentNumbers = shifted ? ROWS.numbersShift : ROWS.numbers;

  return (
    <div className="flex flex-col gap-1 border-t border-zinc-800 bg-zinc-900/98 px-1 py-1.5 backdrop-blur-sm">
      {showSymbols ? (
        <>
          {/* Symbols layout */}
          <div className="flex gap-1">
            {ROWS.symbols1.map((char) => (
              <Key key={char} char={char} onPress={() => handleKey(char)} />
            ))}
          </div>
          <div className="flex gap-1">
            {ROWS.symbols2.map((char) => (
              <Key key={char} char={char} onPress={() => handleKey(char)} />
            ))}
          </div>
          <div className="flex gap-1">
            <Key char="ABC" onPress={() => setShowSymbols(false)} width="wider" variant="special" />
            <Key char="Space" onPress={() => onKeyPress(' ')} width="space" variant="special" />
            <Key char="⌫" onPress={() => onKeyPress(SPECIAL_KEYS.BACKSPACE)} width="wider" variant="special" />
          </div>
        </>
      ) : (
        <>
          {/* Number row */}
          <div className="flex gap-1">
            {currentNumbers.map((char, i) => (
              <Key key={i} char={char} onPress={() => handleKey(char)} />
            ))}
            <Key char="⌫" onPress={() => onKeyPress(SPECIAL_KEYS.BACKSPACE)} width="wide" variant="special" />
          </div>

          {/* QWERTY rows */}
          <div className="flex gap-1">
            {ROWS.row1.map((char) => (
              <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
            ))}
          </div>

          <div className="flex gap-1 px-2">
            {ROWS.row2.map((char) => (
              <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
            ))}
          </div>

          <div className="flex gap-1">
            <Key
              char={shifted ? '⬆' : '⇧'}
              onPress={() => setShifted(!shifted)}
              width="wide"
              variant={shifted ? 'action' : 'special'}
            />
            {ROWS.row3.map((char) => (
              <Key key={char} char={shifted ? char.toUpperCase() : char} onPress={() => handleKey(char)} />
            ))}
            <Key char="⏎" onPress={() => onKeyPress(SPECIAL_KEYS.ENTER)} width="wide" variant="action" />
          </div>

          {/* Bottom row */}
          <div className="flex gap-1">
            <Key
              char={showCtrl ? 'Ctrl✓' : 'Ctrl'}
              onPress={() => setShowCtrl(!showCtrl)}
              width="wide"
              variant={showCtrl ? 'action' : 'special'}
            />
            <Key char="#+=" onPress={() => setShowSymbols(true)} width="wide" variant="special" />
            <Key char="" onPress={() => onKeyPress(' ')} width="space" variant="special" />
            <Key char="Tab" onPress={() => onKeyPress(SPECIAL_KEYS.TAB)} width="wide" variant="special" />
            <Key char="Esc" onPress={() => onKeyPress(SPECIAL_KEYS.ESC)} width="wide" variant="special" />
          </div>
        </>
      )}

      {/* Arrow keys + special row - always visible */}
      <div className="flex gap-1 border-t border-zinc-800 pt-1">
        <Key char="^C" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_C)} width="wide" variant="danger" />
        <Key char="^D" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_D)} width="wide" variant="special" />
        <Key char="^Z" onPress={() => onKeyPress(SPECIAL_KEYS.CTRL_Z)} width="wide" variant="special" />
        <div className="flex-1" />
        <button
          onClick={() => onKeyPress(SPECIAL_KEYS.LEFT)}
          className="flex h-[42px] w-[42px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => onKeyPress(SPECIAL_KEYS.UP)}
            className="flex h-[20px] w-[42px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={() => onKeyPress(SPECIAL_KEYS.DOWN)}
            className="flex h-[20px] w-[42px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => onKeyPress(SPECIAL_KEYS.RIGHT)}
          className="flex h-[42px] w-[42px] items-center justify-center rounded-md bg-zinc-700 text-zinc-300 active:bg-zinc-500"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
