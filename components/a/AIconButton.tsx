/**
 * AIconButton - Icon button component for the design system
 *
 * A consistent icon button with optional tooltip, badge, and dot indicator support.
 *
 * @example
 * ```tsx
 * // Simple icon button
 * <AIconButton icon={Settings} onClick={handleClick} />
 *
 * // With tooltip
 * <AIconButton icon={MessageSquare} tooltip="Comments" onClick={handleClick} />
 *
 * // With badge (for notifications)
 * <AIconButton icon={Bell} tooltip="Notifications" badge={5} onClick={handleClick} />
 *
 * // With dot indicator (for active state)
 * <AIconButton icon={Share2} tooltip="Share" dot dotColor="blue" onClick={handleClick} />
 *
 * // Active/selected state
 * <AIconButton icon={MessageSquare} active onClick={handleClick} />
 * ```
 */

"use client";

import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ATooltip } from "@/components/a/ATooltip";
import { cn } from "@/lib/utils";

export type AIconButtonSize = "sm" | "md" | "lg";
export type AIconButtonHighlight = "blue" | "green" | "red" | "orange" | "purple";

export interface AIconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Lucide icon component */
  icon: LucideIcon;
  /** Optional tooltip text */
  tooltip?: string;
  /** Optional keyboard shortcut hint for tooltip */
  shortcut?: string;
  /** Tooltip position */
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Optional badge count (shows red notification badge) */
  badge?: number;
  /** Show a small dot indicator */
  dot?: boolean;
  /** Dot color (default: "purple") */
  dotColor?: AIconButtonHighlight;
  /** Whether the button is in active/selected state */
  active?: boolean;
  /** Highlight color for the icon */
  highlight?: AIconButtonHighlight;
  /** Button size variant */
  size?: AIconButtonSize;
  /** Button variant */
  variant?: "ghost" | "default" | "muted";
  /** Additional className for the icon */
  iconClassName?: string;
  /** Additional className */
  className?: string;
  /** Accessible label (required if no tooltip) */
  "aria-label"?: string;
}

const SIZE_CLASSES: Record<AIconButtonSize, { button: string; icon: string }> = {
  sm: { button: "h-7 w-7", icon: "h-3.5 w-3.5" },
  md: { button: "h-8 w-8", icon: "h-4 w-4" },
  lg: { button: "h-9 w-9", icon: "h-5 w-5" },
};

const VARIANT_CLASSES = {
  ghost: "bg-transparent hover:bg-muted/60",
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  muted: "bg-muted/40 hover:bg-muted/60",
};

const HIGHLIGHT_CLASSES: Record<AIconButtonHighlight, string> = {
  blue: "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
  green: "text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300",
  red: "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300",
  orange: "text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300",
  purple: "text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300",
};

const DOT_COLORS: Record<AIconButtonHighlight, string> = {
  blue: "bg-blue-500 dark:bg-blue-400",
  green: "bg-green-500 dark:bg-green-400",
  red: "bg-red-500 dark:bg-red-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  purple: "bg-purple-500 dark:bg-purple-400",
};

export const AIconButton = forwardRef<HTMLButtonElement, AIconButtonProps>(
  (
    {
      icon: Icon,
      tooltip,
      shortcut,
      tooltipSide = "bottom",
      badge,
      dot = false,
      dotColor = "purple",
      active = false,
      highlight,
      size = "md",
      variant = "ghost",
      iconClassName,
      className,
      disabled,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    const sizeClasses = SIZE_CLASSES[size];

    const button = (
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={ariaLabel || tooltip}
        className={cn(
          "relative p-0",
          sizeClasses.button,
          active ? VARIANT_CLASSES.default : VARIANT_CLASSES[variant],
          highlight && !active && HIGHLIGHT_CLASSES[highlight],
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
        {...props}
      >
        <Icon className={cn(sizeClasses.icon, iconClassName)} />

        {/* Badge with count */}
        {badge !== undefined && badge > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px] font-medium"
          >
            {badge > 99 ? "99+" : badge}
          </Badge>
        )}

        {/* Dot indicator */}
        {dot && !badge && (
          <div
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full",
              DOT_COLORS[dotColor]
            )}
          />
        )}
      </Button>
    );

    if (tooltip) {
      return (
        <ATooltip
          content={tooltip}
          shortcut={shortcut}
          side={tooltipSide}
          disabled={disabled}
        >
          {button}
        </ATooltip>
      );
    }

    return button;
  }
);

AIconButton.displayName = "AIconButton";
