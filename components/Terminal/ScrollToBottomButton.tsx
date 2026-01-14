"use client";

import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({
  visible,
  onClick,
}: ScrollToBottomButtonProps) {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "absolute right-6 bottom-6 p-3",
        "bg-primary/90 hover:bg-primary backdrop-blur-sm",
        "text-primary-foreground shadow-primary/30 rounded-full shadow-xl",
        "transition-all hover:scale-105 active:scale-95",
        "animate-bounce"
      )}
      title="Scroll to bottom"
    >
      <ArrowDown className="h-5 w-5" />
    </button>
  );
}
