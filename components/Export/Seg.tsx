"use client";

import { cn } from "@/lib/utils";

// A row of exclusive choices, each at least 44px tall.
export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; sub?: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-lg border px-2 text-sm transition-colors",
            value === o.id
              ? "border-primary bg-primary/10 text-foreground"
              : "text-muted-foreground hover:bg-foreground/[0.04]"
          )}
        >
          <span className="font-medium">{o.label}</span>
          {o.sub && <span className="text-[11px] opacity-80">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}
