"use client";

import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatModel } from "@/lib/chat/events";
import { ModelNote } from "./ModelNote";
import type { Elsewhere, Section } from "./sections";

// The query's words picked out in a name.
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "ig"
  );
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="text-foreground bg-primary/25 rounded-sm">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

function Row({
  model,
  selected,
  query,
  onPick,
}: {
  model: ChatModel;
  selected: boolean;
  query: string;
  onPick: (value: string) => void;
}) {
  const sub = model.disabled ?? model.description;
  return (
    <button
      type="button"
      data-pick-row
      data-selected={selected || undefined}
      disabled={!!model.disabled}
      onClick={() => onPick(model.value)}
      className={cn(
        "hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.07] flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left outline-none disabled:opacity-50 md:min-h-9",
        selected && "bg-primary/10"
      )}
    >
      <Check
        className={cn(
          "text-primary h-3.5 w-3.5 shrink-0",
          selected ? "opacity-100" : "opacity-0"
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className="truncate text-sm">
          <Highlight text={model.label} query={query} />
        </span>
        {sub && (
          <span className="text-muted-foreground line-clamp-2 text-xs">
            {sub}
          </span>
        )}
      </span>
      {model.note && <ModelNote note={model.note} />}
    </button>
  );
}

/** The models of one agent in sections, the chosen one ticked. */
export function ModelList({
  sections,
  selected,
  query,
  agentLabel,
  elsewhere,
  onPick,
  onJump,
}: {
  sections: Section[];
  selected: string | null;
  query: string;
  agentLabel: string;
  elsewhere?: Elsewhere | null;
  onPick: (value: string) => void;
  onJump?: (agent: string) => void;
}) {
  if (sections.length === 0)
    return (
      <p className="text-muted-foreground px-3 py-6 text-center text-sm">
        No {agentLabel ? `${agentLabel} ` : ""}model matches &ldquo;
        {query.trim()}&rdquo;.
        {elsewhere && onJump && (
          <button
            type="button"
            data-pick-row
            onClick={() => onJump(elsewhere.agent)}
            className="text-primary mt-2 block min-h-11 w-full font-medium hover:underline"
          >
            {elsewhere.count} match in other agents
          </button>
        )}
      </p>
    );
  return (
    <div data-model-list className="flex flex-col gap-0.5 p-1.5">
      {sections.map((s) => (
        <div key={s.key} className="flex flex-col gap-0.5">
          <div className="text-muted-foreground flex items-center justify-between px-2 pt-2 pb-1 text-[11px] font-medium">
            <span className="flex items-center gap-1">
              {s.kind === "last" && <Clock className="h-3 w-3" />}
              {s.heading}
            </span>
            {s.kind === "group" && <span>{s.models.length}</span>}
          </div>
          {s.models.map((m) => (
            <Row
              key={m.value}
              model={m}
              selected={m.value === selected}
              query={query}
              onPick={onPick}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
