"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingActionButtonProps {
  onClick: () => void;
  className?: string;
}

/**
 * Floating Action Button for mobile
 * Fixed position, bottom-right corner
 */
export function FloatingActionButton({
  onClick,
  className,
}: FloatingActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed bottom-20 right-4 z-40",
        "w-14 h-14 rounded-full", // Large touch target
        "bg-primary text-primary-foreground",
        "shadow-lg hover:shadow-xl",
        "transition-all duration-200",
        "flex items-center justify-center",
        "active:scale-95",
        "md:hidden", // Only show on mobile
        className
      )}
      aria-label="New session"
    >
      <Plus className="w-6 h-6" />
    </button>
  );
}
