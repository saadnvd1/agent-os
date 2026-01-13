/**
 * ATooltip - Simple tooltip wrapper for the design system
 *
 * Wraps Radix tooltip primitives into a single, easy-to-use component.
 *
 * @example
 * ```tsx
 * <ATooltip content="Edit document">
 *   <Button>Edit</Button>
 * </ATooltip>
 *
 * // With shortcut hint
 * <ATooltip content="Save" shortcut="Cmd+S">
 *   <Button>Save</Button>
 * </ATooltip>
 * ```
 */

"use client";

import { type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ATooltipProps {
  /** The element that triggers the tooltip */
  children: ReactNode;
  /** Tooltip content - can be a string or ReactNode */
  content: ReactNode;
  /** Optional keyboard shortcut hint (e.g., "Cmd+S") */
  shortcut?: string;
  /** Side of the trigger to render the tooltip (default: "top") */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment of the tooltip relative to trigger (default: "center") */
  align?: "start" | "center" | "end";
  /** Delay in ms before showing tooltip (default: 300) */
  delayDuration?: number;
  /** Whether the tooltip is disabled */
  disabled?: boolean;
  /** Additional className for the tooltip content */
  className?: string;
}

export function ATooltip({
  children,
  content,
  shortcut,
  side = "top",
  align = "center",
  delayDuration = 300,
  disabled = false,
  className,
}: ATooltipProps) {
  if (disabled || !content) {
    return <>{children}</>;
  }

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={cn(className)}>
        <div className="flex items-center gap-2">
          <span>{content}</span>
          {shortcut && (
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {shortcut}
            </kbd>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
