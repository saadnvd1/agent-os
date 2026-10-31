"use client";

import { useRef } from "react";
import { ChevronDown, Lock } from "lucide-react";
import type { ChatModel } from "@/lib/chat/events";
import { ModelList } from "@/components/Draft/picker/ModelList";
import { PickerSheet } from "@/components/Draft/picker/PickerSheet";
import { SearchField } from "@/components/Draft/picker/SearchField";
import {
  focusSelectedRow,
  useListKeys,
} from "@/components/Draft/picker/useListKeys";
import { useModelSearch } from "@/components/Draft/picker/useModelSearch";

export function modelLabel(
  models: ChatModel[],
  value: string,
  serverLabel?: string
): string {
  return models.find((m) => m.value === value)?.label ?? (serverLabel || value);
}

/**
 * The list value a chat's model is: itself, or the family alias when the chat
 * holds a full id ("claude-opus-5-5" is the "opus" row).
 */
export function currentModelValue(
  models: ChatModel[],
  model: string
): string | undefined {
  if (models.some((m) => m.value === model)) return model;
  const family = /^claude-([a-z]+)-\d/.exec(model)?.[1];
  return family ? models.find((m) => m.value === family)?.value : undefined;
}

// The session's model, switchable mid-conversation. Opened by its button or /model.
export function ModelPicker({
  models,
  model,
  label,
  agentName,
  open,
  onOpenChange,
  onPick,
}: {
  models: ChatModel[];
  model: string;
  label?: string;
  agentName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (value: string) => void;
}) {
  const current = currentModelValue(models, model);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const { query, setQuery, sections } = useModelSearch({
    agent: { agent: "chat", label: "", models },
    currentValue: current,
    open,
  });
  const onKeyDown = useListKeys(root, search);
  if (!model && models.length === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Model"
        aria-haspopup="dialog"
        onClick={() => onOpenChange(true)}
        className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] flex h-10 max-w-36 min-w-0 items-center gap-1 rounded-lg px-2 text-xs"
      >
        <span className="truncate">
          {modelLabel(models, model, label) || "Model"}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      <PickerSheet
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
        }}
        title="Model"
        onKeyDown={onKeyDown}
        onOpened={() => focusSelectedRow(root.current)}
      >
        <div ref={root} className="flex min-h-0 flex-1 flex-col">
          <p className="text-muted-foreground bg-foreground/[0.03] mx-1.5 mt-1.5 flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            {agentName && `${agentName} · `}
            {agentName ? "switching" : "Switching"} agent starts a new session
          </p>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search models"
            inputRef={search}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ModelList
              sections={sections}
              selected={current ?? null}
              query={query}
              agentLabel=""
              onPick={(value) => {
                onPick(value);
                onOpenChange(false);
              }}
            />
          </div>
        </div>
      </PickerSheet>
    </>
  );
}
