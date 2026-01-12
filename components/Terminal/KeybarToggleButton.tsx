'use client';

import { Keyboard, KeyboardOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KeybarToggleButtonProps {
  isVisible: boolean;
  onToggle: () => void;
}

/**
 * Floating button to toggle mobile keybar visibility.
 * Positioned at bottom-right of terminal, above the keybar when visible.
 */
export function KeybarToggleButton({ isVisible, onToggle }: KeybarToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'absolute z-30',
        'flex items-center justify-center',
        'h-11 w-11 rounded-full',
        'bg-zinc-800/80 backdrop-blur-sm',
        'border border-zinc-700',
        'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100',
        'touch-manipulation transition-all duration-200',
        'active:scale-95',
        // Position: bottom-right, moves up when keybar is visible
        isVisible ? 'bottom-[116px] right-3' : 'bottom-4 right-3'
      )}
      aria-label={isVisible ? 'Hide keyboard' : 'Show keyboard'}
    >
      {isVisible ? <KeyboardOff className="h-5 w-5" /> : <Keyboard className="h-5 w-5" />}
    </button>
  );
}
