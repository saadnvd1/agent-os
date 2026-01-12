'use client';

import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomButtonProps) {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      className={cn(
        'absolute bottom-6 right-6 p-3',
        'bg-primary/90 backdrop-blur-sm hover:bg-primary',
        'rounded-full text-white shadow-xl shadow-primary/30',
        'transition-all hover:scale-105 active:scale-95',
        'animate-bounce'
      )}
      title="Scroll to bottom"
    >
      <ArrowDown className="h-5 w-5" />
    </button>
  );
}
