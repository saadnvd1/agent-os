"use client";

import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const chipClass =
  "border-border/70 bg-card text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] flex h-11 max-w-full min-w-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs md:h-8 disabled:pointer-events-none disabled:opacity-60";

// One of a draft's choices: what it is now, and a menu to change it.
export function ChipMenu({
  icon: Icon,
  label,
  name,
  disabled,
  title,
  children,
}: {
  icon: LucideIcon;
  label: string;
  // What the choice is, for screen readers.
  name: string;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`${name}: ${label}`}
          title={title}
          className={chipClass}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          {!disabled && <ChevronDown className="h-3 w-3 shrink-0" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(60vh,420px)] max-w-80 overflow-y-auto"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChipItem({
  checked,
  onSelect,
  children,
  hint,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      disabled={disabled}
      className="flex min-h-11 items-start gap-2 md:min-h-8"
    >
      <Check
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          checked ? "opacity-100" : "opacity-0"
        )}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{children}</span>
        {hint && (
          <span className="text-muted-foreground truncate text-xs">{hint}</span>
        )}
      </span>
    </DropdownMenuItem>
  );
}

export function ChipHeading({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-muted-foreground text-[11px] font-medium">
        {children}
      </DropdownMenuLabel>
    </>
  );
}

// An on/off choice, as a chip.
export function ChipToggle({
  icon: Icon,
  label,
  on,
  onChange,
  title,
}: {
  icon: LucideIcon;
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        chipClass,
        on && "border-primary/40 bg-primary/10 text-primary hover:text-primary"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
