"use client";

import { useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  Sparkles,
} from "lucide-react";
import type { ChatItem, PeerMessage as Peer } from "@/lib/chat/events";
import { cn } from "@/lib/utils";
import { leadingCommand } from "@/lib/chat/commands";
import { CopyButton } from "./CopyButton";
import { ImageThumb } from "./ImageThumb";
import { Markdown } from "./Markdown";
import { UndoButton } from "./Undo";

type Of<K extends ChatItem["kind"]> = Extract<ChatItem, { kind: K }>;

function UserText({ text }: { text: string }) {
  const command = leadingCommand(text);
  if (!command) return <>{text}</>;
  return (
    <>
      <span className="text-primary font-mono">{command}</span>
      {text.slice(command.length)}
    </>
  );
}

export function UserMessage({
  item,
  onUndo,
}: {
  item: Of<"user">;
  onUndo?: () => void;
}) {
  return (
    <div className="group flex flex-col items-end gap-1">
      {item.from && (
        <span className="label-mono text-muted-foreground">
          from {item.from}
        </span>
      )}
      {item.images?.length ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {item.images.map((img, i) => (
            <ImageThumb
              key={i}
              src={`data:${img.mediaType};base64,${img.data}`}
            />
          ))}
        </div>
      ) : null}
      {item.text && (
        <div className="bg-foreground/[0.07] max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap">
          <UserText text={item.text} />
        </div>
      )}
      {onUndo && <UndoButton onClick={onUndo} />}
    </div>
  );
}

// A message another agent session sent over the bus: its words, from the
// other side of the conversation, without the reply instructions the agent
// reading it gets.
export function PeerMessage({ item, peer }: { item: Of<"user">; peer: Peer }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Bot className="text-primary h-3.5 w-3.5" />
        <span className="text-foreground/80 font-medium">{item.from}</span>
        <span>sent a message</span>
      </span>
      <div className="bg-primary/[0.07] max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
        {peer.body}
      </div>
    </div>
  );
}

export function AssistantMessage({ item }: { item: Of<"assistant"> }) {
  return (
    <div className="group">
      <div data-quotable className={cn(item.streaming && "streaming-cursor")}>
        <Markdown text={item.text} streaming={item.streaming} />
      </div>
      {!item.streaming && (
        <CopyButton
          text={item.text}
          label="Copy message"
          className="-ml-1.5 opacity-40 group-hover:opacity-100 md:opacity-0"
        />
      )}
    </div>
  );
}

export function Reasoning({ item }: { item: Of<"reasoning"> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-muted-foreground text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="hover:text-foreground flex min-h-8 items-center gap-1"
      >
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        />
        {item.streaming ? "Thinking…" : "Thought"}
      </button>
      {open && (
        <p className="border-l-2 pl-3 whitespace-pre-wrap">{item.text}</p>
      )}
    </div>
  );
}

export function Todos({ item }: { item: Of<"todos"> }) {
  return (
    <div className="bg-foreground/[0.03] space-y-1.5 rounded-xl px-3.5 py-3">
      <p className="label-mono text-muted-foreground">Plan</p>
      {item.todos.map((t, i) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          {t.status === "completed" ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          ) : t.status === "in_progress" ? (
            <CircleDot className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <Circle className="text-muted-foreground/50 mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span
            className={cn(
              t.status === "completed" && "text-muted-foreground line-through"
            )}
          >
            {t.text}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TurnEnd({ item }: { item: Of<"turn_end"> }) {
  const secs = item.durationMs ? Math.round(item.durationMs / 1000) : null;
  const label = item.interrupted
    ? "Stopped"
    : secs !== null
      ? `Done in ${secs}s`
      : "Done";
  return (
    <div className="text-muted-foreground/60 flex items-center gap-3 font-mono text-[11px]">
      <span className="bg-foreground/[0.06] h-px flex-1" />
      {label}
      <span className="bg-foreground/[0.06] h-px flex-1" />
    </div>
  );
}

export function ErrorMessage({ item }: { item: Of<"error"> }) {
  return (
    <div className="bg-destructive/10 text-destructive rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap">
      {item.message}
    </div>
  );
}

export function CommandOutput({ item }: { item: Of<"command_output"> }) {
  return (
    <pre className="bg-foreground/[0.03] text-muted-foreground max-h-80 overflow-auto rounded-xl px-3.5 py-2.5 font-mono text-xs whitespace-pre-wrap">
      {item.text}
    </pre>
  );
}

const NOTE_LABEL = {
  note: "Note",
  brake: "Brake",
  escalation: "Saad decides",
  ask: "Ask",
  pause: "Pause",
} as const;

export function NoteLine({ item }: { item: Of<"note"> }) {
  return (
    <div
      className={cn(
        "rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
        item.tone === "escalation"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "bg-primary/[0.06] text-foreground/80"
      )}
    >
      <span className="text-muted-foreground mr-2 font-mono text-[11px] tracking-wide uppercase">
        {NOTE_LABEL[item.tone]}
      </span>
      {item.text}
    </div>
  );
}

export function Compacted({ item }: { item: Of<"compacted"> }) {
  return (
    <div className="text-muted-foreground/60 flex items-center gap-3 font-mono text-[11px]">
      <span className="bg-foreground/[0.06] h-px flex-1" />
      {item.trigger === "auto"
        ? "Context compacted automatically"
        : "Context compacted"}
      <span className="bg-foreground/[0.06] h-px flex-1" />
    </div>
  );
}

export function SkillChip({ item }: { item: Of<"tool"> }) {
  const name = (item.input as { skill?: string } | null)?.skill ?? item.title;
  return (
    <div className="flex">
      <span className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs">
        <Sparkles className="h-3 w-3" />
        {name}
      </span>
    </div>
  );
}
