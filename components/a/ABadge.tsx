/**
 * ABadge - Standard badge component for the design system
 *
 * A consistent badge for labels, statuses, and feature indicators.
 *
 * @example
 * ```tsx
 * // Simple badge
 * <ABadge>Default</ABadge>
 *
 * // New feature indicator
 * <ABadge variant="new">New</ABadge>
 *
 * // Beta indicator
 * <ABadge variant="beta">Beta</ABadge>
 *
 * // Small size
 * <ABadge size="sm" variant="new">New</ABadge>
 * ```
 */

"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ABadgeSize = "sm" | "md";
export type ABadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "new"
  | "beta"
  | "pro"
  | "waiting"
  | "running"
  | "idle";

export interface ABadgeProps {
  /** Badge content */
  children: React.ReactNode;
  /** Badge style variant */
  variant?: ABadgeVariant;
  /** Badge size */
  size?: ABadgeSize;
  /** Additional className */
  className?: string;
}

const SIZE_CLASSES: Record<ABadgeSize, string> = {
  sm: "h-4 px-1.5 py-0 text-[10px] leading-none",
  md: "h-5 px-2 py-0 text-xs leading-none",
};

const VARIANT_CLASSES: Record<ABadgeVariant, string> = {
  default: "",
  secondary: "",
  destructive: "",
  outline: "",
  new: "border-transparent bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
  beta: "border-transparent bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
  pro: "border-transparent bg-violet-500/15 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400",
  waiting:
    "border-transparent bg-yellow-500/15 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-400",
  running:
    "border-transparent bg-green-500/15 text-green-600 dark:bg-green-500/20 dark:text-green-400",
  idle: "border-transparent bg-gray-500/15 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400",
};

const BASE_VARIANT_MAP: Record<
  ABadgeVariant,
  "default" | "secondary" | "destructive" | "outline"
> = {
  default: "default",
  secondary: "secondary",
  destructive: "destructive",
  outline: "outline",
  new: "secondary",
  beta: "secondary",
  pro: "secondary",
  waiting: "secondary",
  running: "secondary",
  idle: "secondary",
};

export function ABadge({
  children,
  variant = "default",
  size = "md",
  className,
}: ABadgeProps) {
  const isCustomVariant = [
    "new",
    "beta",
    "pro",
    "waiting",
    "running",
    "idle",
  ].includes(variant);

  return (
    <Badge
      variant={BASE_VARIANT_MAP[variant]}
      className={cn(
        "flex items-center justify-center font-medium",
        SIZE_CLASSES[size],
        isCustomVariant && VARIANT_CLASSES[variant],
        className
      )}
    >
      {children}
    </Badge>
  );
}
