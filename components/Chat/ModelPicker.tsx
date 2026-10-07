"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatModel } from "@/lib/chat/events";

export function modelLabel(models: ChatModel[], value: string): string {
  return models.find((m) => m.value === value)?.label ?? value;
}

// The session's model, switchable mid-conversation. Opened by its button or /model.
export function ModelPicker({
  models,
  model,
  open,
  onOpenChange,
  onPick,
}: {
  models: ChatModel[];
  model: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (value: string) => void;
}) {
  if (!model && models.length === 0) return null;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Model"
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] flex h-10 max-w-36 min-w-0 items-center gap-1 rounded-lg px-2 text-xs"
        >
          <span className="truncate">
            {modelLabel(models, model) || "Model"}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-w-80">
        {models.map((m) => (
          <DropdownMenuItem
            key={m.value}
            onSelect={() => onPick(m.value)}
            className="flex min-h-11 items-start gap-2 md:min-h-9"
          >
            <Check
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${m.value === model ? "opacity-100" : "opacity-0"}`}
            />
            <span className="flex flex-col">
              <span className="text-sm">{m.label}</span>
              {m.description && (
                <span className="text-muted-foreground line-clamp-2 text-xs">
                  {m.description}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
