"use client";

import {
  Check,
  ChevronDown,
  Shield,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CHAT_ACCESS, type ChatAccess } from "@/lib/chat/events";

const LEVELS: Record<
  ChatAccess,
  { label: string; description: string; icon: typeof Shield }
> = {
  ask: {
    label: "Ask first",
    description: "Asks before edits and commands it isn't already allowed",
    icon: ShieldCheck,
  },
  edits: {
    label: "Accept edits",
    description: "Edits files on its own, asks before other commands",
    icon: Shield,
  },
  full: {
    label: "Full access",
    description: "Does everything without asking",
    icon: ShieldOff,
  },
};

// What the agent may do without asking, switchable mid-conversation.
export function AccessPicker({
  access,
  onPick,
}: {
  access: ChatAccess;
  onPick: (access: ChatAccess) => void;
}) {
  const current = LEVELS[access] ?? LEVELS.full;
  const Icon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Access"
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs"
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{current.label}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-w-80">
        {CHAT_ACCESS.map((level) => {
          const l = LEVELS[level];
          return (
            <DropdownMenuItem
              key={level}
              onSelect={() => onPick(level)}
              className="flex min-h-11 items-start gap-2 md:min-h-9"
            >
              <Check
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${level === access ? "opacity-100" : "opacity-0"}`}
              />
              <span className="flex flex-col">
                <span className="text-sm">{l.label}</span>
                <span className="text-muted-foreground text-xs">
                  {l.description}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
