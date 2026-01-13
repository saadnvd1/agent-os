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
        'absolute z-30 right-3',
        'flex items-center justify-center',
        'h-11 w-11 rounded-full',
        'bg-secondary/90 backdrop-blur-sm',
        'shadow-lg',
        'text-muted-foreground hover:bg-accent hover:text-foreground',
        'touch-manipulation transition-all duration-200',
        'active:scale-95',
        // Position: moves up when keyboard is visible (accounts for safe-area + taller keys + recent commands bar)
        isVisible ? 'bottom-[265px]' : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
      )}
      aria-label={isVisible ? 'Hide keyboard' : 'Show keyboard'}
    >
      {isVisible ? <KeyboardOff className="h-5 w-5" /> : <Keyboard className="h-5 w-5" />}
    </button>
  );
}
