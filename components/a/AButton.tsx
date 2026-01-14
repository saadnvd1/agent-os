/**
 * AButton - Standard button component for the design system
 *
 * A consistent button with optional tooltip, loading state, and icon support.
 *
 * @example
 * ```tsx
 * // Simple button
 * <AButton onClick={handleClick}>Save</AButton>
 *
 * // With icon
 * <AButton icon={Plus} onClick={handleClick}>Add item</AButton>
 *
 * // With tooltip
 * <AButton tooltip="Save changes" onClick={handleClick}>Save</AButton>
 *
 * // Loading state
 * <AButton loading onClick={handleClick}>Saving...</AButton>
 *
 * // Ghost variant (no background/border)
 * <AButton variant="ghost" onClick={handleClick}>Cancel</AButton>
 * ```
 */

"use client";

import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATooltip } from "@/components/a/ATooltip";
import { cn } from "@/lib/utils";

export type AButtonSize = "sm" | "md" | "lg";
export type AButtonVariant =
  | "default"
  | "ghost"
  | "outline"
  | "secondary"
  | "destructive"
  | "link";

export interface AButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** Button content */
  children?: React.ReactNode;
  /** Optional Lucide icon component (shown before text) */
  icon?: LucideIcon;
  /** Optional icon shown after text */
  iconRight?: LucideIcon;
  /** Optional tooltip text */
  tooltip?: string;
  /** Optional keyboard shortcut hint for tooltip */
  shortcut?: string;
  /** Tooltip position */
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Loading state - shows spinner and disables button */
  loading?: boolean;
  /** Button size variant */
  size?: AButtonSize;
  /** Button style variant */
  variant?: AButtonVariant;
  /** Make the button take full width */
  fullWidth?: boolean;
  /** Additional className for the icon */
  iconClassName?: string;
  /** Additional className */
  className?: string;
}

const SIZE_CLASSES: Record<AButtonSize, { button: string; icon: string }> = {
  sm: { button: "h-7 px-2 text-xs", icon: "h-3.5 w-3.5" },
  md: { button: "h-8 px-3 text-sm", icon: "h-4 w-4" },
  lg: { button: "h-10 px-4 text-base", icon: "h-5 w-5" },
};

const VARIANT_MAP: Record<
  AButtonVariant,
  "default" | "ghost" | "outline" | "secondary" | "destructive" | "link"
> = {
  default: "default",
  ghost: "ghost",
  outline: "outline",
  secondary: "secondary",
  destructive: "destructive",
  link: "link",
};

export const AButton = forwardRef<HTMLButtonElement, AButtonProps>(
  (
    {
      children,
      icon: Icon,
      iconRight: IconRight,
      tooltip,
      shortcut,
      tooltipSide = "bottom",
      loading = false,
      size = "md",
      variant = "default",
      fullWidth = false,
      iconClassName,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const sizeClasses = SIZE_CLASSES[size];
    const isDisabled = disabled || loading;

    const button = (
      <Button
        ref={ref}
        variant={VARIANT_MAP[variant]}
        disabled={isDisabled}
        className={cn(
          sizeClasses.button,
          fullWidth && "w-full",
          variant === "ghost" &&
            "border-0 shadow-none ring-0 focus:ring-0 focus-visible:ring-0",
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className={cn(sizeClasses.icon, "mr-2 animate-spin")} />
        ) : Icon ? (
          <Icon
            className={cn(sizeClasses.icon, children && "mr-2", iconClassName)}
          />
        ) : null}

        {children}

        {IconRight && !loading && (
          <IconRight
            className={cn(sizeClasses.icon, children && "ml-2", iconClassName)}
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
          disabled={isDisabled}
        >
          {button}
        </ATooltip>
      );
    }

    return button;
  }
);

AButton.displayName = "AButton";
