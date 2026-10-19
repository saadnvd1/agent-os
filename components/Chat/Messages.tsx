"use client";

import { memo } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  Quote,
  Sparkles,
} from "lucide-react";
import type { ChatItem } from "@/lib/chat/events";
import type { PendingSend } from "@/lib/chat/pending";
import { cn } from "@/lib/utils";
import { leadingCommand } from "@/lib/chat/commands";
import { compactedLine } from "@/lib/chat/stale";
import { splitProse, splitUserText } from "@/lib/chat/user-text";
import { inAppSessionId } from "@/lib/session-url";
import { CodeBlock } from "./Code";
import { CopyButton } from "./CopyButton";
import { FileChip } from "./FileChip";
import { ImageThumb } from "./ImageThumb";
import { Markdown } from "./Markdown";
import { openSessionLink } from "./session-link";
import { UndoButton } from "./Undo";
import { useRowState } from "./rowState";
import {
  BookmarkButton,
  TurnBookmark,
  BookmarkPress,
} from "@/components/Bookmarks/BookmarkButton";

type Of<K extends ChatItem["kind"]> = Extract<ChatItem, { kind: K }>;

function UserLink({ href }: { href: string }) {
  const id =
    typeof window === "undefined"
      ? null
      : inAppSessionId(href, window.location.origin);
  return (
    <a
      href={href}
      target={id ? undefined : "_blank"}
      rel={id ? undefined : "noopener noreferrer"}
      onClick={id ? (e) => openSessionLink(e, id) : undefined}
      className="chat-link font-medium"
    >
      {href}
    </a>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <>
      {splitProse(text).map((p, i) =>
        p.kind === "code" ? (
          <code
            key={i}
            className="bg-foreground/[0.06] rounded px-1 py-0.5 font-mono text-[0.9em]"
          >
            {p.text}
          </code>
        ) : p.kind === "link" ? (
          <UserLink key={i} href={p.text} />
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

// Memoized: a chat full of pasted articles re-renders its rows when a turn
// starts and ends, and splitting and linking each one again is the cost.
const UserText = memo(function UserText({ text }: { text: string }) {
  return (
    <>
      {splitUserText(text).map((part, i) => {
        if (part.kind === "code")
          return (
            <div key={i} className="my-1.5 first:mt-0 last:mb-0">
              <CodeBlock code={part.code} language={part.language} />
            </div>
          );
        const command = i === 0 ? leadingCommand(part.text) : null;
        if (!command) return <Prose key={i} text={part.text} />;
        return (
          <span key={i}>
            <span className="text-primary font-mono">{command}</span>
            <Prose text={part.text.slice(command.length)} />
          </span>
        );
      })}
    </>
  );
});

// A sent message not in the chat yet (lib/chat/pending).
export interface PendingStatus {
  status: PendingSend["status"];
  // The chat is compacting for this send (its real state, not a guess).
  compacting?: boolean;
  error?: string;
  onRetry: () => void;
  onEdit: () => void;
}

function StatusButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-foreground hover:bg-foreground/[0.06] min-h-11 rounded-md px-2 underline underline-offset-2 md:min-h-7"
    >
      {children}
    </button>
  );
}

function SendStatus({ pending }: { pending: PendingStatus }) {
  if (pending.status === "failed")
    return (
      <div
        data-copy-skip
        role="alert"
        className="text-destructive flex items-center gap-1 font-mono text-[11px]"
      >
        <span>Not sent · {pending.error}</span>
        <StatusButton onClick={pending.onRetry}>Retry</StatusButton>
        <StatusButton onClick={pending.onEdit}>Edit</StatusButton>
      </div>
    );
  return (
    <div
      data-copy-skip
      aria-live="polite"
      className="text-muted-foreground status-late flex items-center gap-1.5 font-mono text-[11px]"
    >
      <span className="status-live bg-muted-foreground h-1.5 w-1.5 rounded-full" />
      {pending.status !== "accepted"
        ? "Sending"
        : pending.compacting
          ? "Compacting first"
          : "Starting the agent"}
    </div>
  );
}

export function UserMessage({
  item,
  onUndo,
  pending,
}: {
  item: Of<"user">;
  onUndo?: () => void;
  pending?: PendingStatus;
}) {
  const message = (
    <div className="group flex flex-col items-end gap-1">
      {item.from && (
        <span data-copy-skip className="label-mono text-muted-foreground">
          from {item.from}
        </span>
      )}
      {item.images?.length ? (
        <div data-copy-skip className="flex flex-wrap justify-end gap-1.5">
          {item.images.map((img, i) => (
            <ImageThumb
              key={i}
              src={`data:${img.mediaType};base64,${img.data}`}
            />
          ))}
        </div>
      ) : null}
      {item.files?.length ? (
        <div data-copy-skip className="flex flex-wrap justify-end gap-1.5">
          {item.files.map((f) => (
            <FileChip key={f.path} file={f} />
          ))}
        </div>
      ) : null}
      {item.text && (
        <div
          className={cn(
            "bg-foreground/[0.07] max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap",
            pending &&
              (pending.status === "failed"
                ? "ring-destructive ring-1 ring-inset"
                : "opacity-60")
          )}
        >
          <UserText text={item.text} />
        </div>
      )}
      {pending ? (
        <SendStatus pending={pending} />
      ) : (
        <div className="-mr-1.5 flex items-center">
          {onUndo && <UndoButton onClick={onUndo} />}
          <BookmarkButton itemId={item.id} />
        </div>
      )}
    </div>
  );
  // Not in the chat yet: nothing to star.
  if (pending) return message;
  return <BookmarkPress itemId={item.id}>{message}</BookmarkPress>;
}

export function AssistantMessage({
  item,
  onQuote,
}: {
  item: Of<"assistant">;
  onQuote?: (text: string) => void;
}) {
  return (
    <BookmarkPress itemId={item.id}>
      <div className="group">
        <div data-quotable className={cn(item.streaming && "streaming-cursor")}>
          <Markdown text={item.text} streaming={item.streaming} />
        </div>
        {!item.streaming && (
          <div className="-ml-1.5 flex items-center">
            <div className="flex items-center opacity-40 group-hover:opacity-100 md:opacity-0">
              <CopyButton text={item.text} label="Copy message" />
              {onQuote && (
                <button
                  type="button"
                  aria-label="Quote message"
                  title="Quote"
                  onClick={() => onQuote(item.text)}
                  className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-9 w-9 items-center justify-center rounded-md md:h-7 md:w-7"
                >
                  <Quote className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <BookmarkButton itemId={item.id} />
          </div>
        )}
      </div>
    </BookmarkPress>
  );
}

export function Reasoning({ item }: { item: Of<"reasoning"> }) {
  const [open, setOpen] = useRowState(`reasoning:${item.id}`, false);
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
    <div className="group text-muted-foreground/60 flex items-center gap-3 font-mono text-[11px]">
      <span className="bg-foreground/[0.06] h-px flex-1" />
      {label}
      <TurnBookmark turnEndId={item.id} />
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
  away: "Away",
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
      {compactedLine(item)}
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
