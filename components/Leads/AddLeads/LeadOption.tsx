"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeadAvatar } from "@/components/SessionList/RowParts";
import { memberLetter } from "@/lib/leads/order";
import type { AdoptCandidate } from "@/lib/leads/setup";
import { NEW_CHAT } from "@/lib/leads/add-plan";
import { cn } from "@/lib/utils";

// One lead in the sheet: a tick, its avatar, its title and what it covers.
// `locked` is ticked for good (the Tech lead, or a lead already added).
export function LeadOption({
  kind,
  letter = memberLetter(kind),
  title,
  detail,
  checked,
  locked = false,
  radio = false,
  onToggle,
  children,
}: {
  kind: string;
  letter?: string;
  title: string;
  detail: ReactNode;
  checked: boolean;
  locked?: boolean;
  // One of several, picked alone (Adopt as lead).
  radio?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="bg-foreground/[0.03] rounded-lg">
      <button
        type="button"
        role={radio ? "radio" : "checkbox"}
        aria-checked={checked}
        aria-disabled={locked}
        onClick={() => !locked && onToggle?.()}
        className={cn(
          "flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
          !locked && "hover:bg-foreground/[0.04]",
          locked && "cursor-default"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center",
            radio ? "rounded-full" : "rounded-md",
            checked
              ? "bg-primary text-primary-foreground"
              : "bg-foreground/[0.08]",
            locked && checked && "opacity-60"
          )}
        >
          {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        <span aria-hidden className="contents">
          <LeadAvatar member={{ kind, letter, title }} size="md" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-muted-foreground text-xs leading-snug">
            {detail}
          </span>
        </span>
      </button>
      {children && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// Start a lead as a new chat, or adopt one of the workspace's chats (which
// keeps its whole conversation).
export function StartAs({
  label,
  value,
  candidates,
  onChange,
}: {
  label: string;
  value: string;
  candidates: readonly AdoptCandidate[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-11 w-full md:h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NEW_CHAT} className="min-h-11 md:min-h-8">
          Start a new chat
        </SelectItem>
        {candidates.map((c) => (
          <SelectItem
            key={c.sessionId}
            value={c.sessionId}
            className="min-h-11 md:min-h-8"
          >
            Adopt “{c.name}”
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
