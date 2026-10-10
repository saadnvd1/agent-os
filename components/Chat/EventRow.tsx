"use client";

import type { MouseEvent } from "react";
import {
  Bot,
  CalendarClock,
  ChevronRight,
  Info,
  UserCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ChatItem, ChatOrigin, ChatOriginKind } from "@/lib/chat/events";
import { eventParts, originOf } from "@/lib/chat/origin";
import { hrefWithSession } from "@/lib/session-url";
import { cn } from "@/lib/utils";
import { UserMessage } from "./Messages";
import { useRowState } from "./rowState";

type UserItem = Extract<ChatItem, { kind: "user" }>;

const ICON: Record<ChatOriginKind, LucideIcon> = {
  event: Zap,
  peer: Bot,
  schedule: CalendarClock,
  system: Info,
  decision: UserCheck,
};

// Longer than this (what fits beside a source on a phone), or more than one line,
// and it opens on a tap.
const SHORT = 32;

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Opens the session through its address, the way a shared link does.
function openSession(e: MouseEvent<HTMLAnchorElement>, id: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  window.history.pushState(null, "", hrefWithSession(location.href, id));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Source({ origin }: { origin: ChatOrigin }) {
  const name = (
    <span className="text-foreground/80 font-medium">{origin.label}</span>
  );
  if (!origin.sessionId) return name;
  const id = origin.sessionId;
  return (
    <a
      href={hrefWithSession("/", id)}
      onClick={(e) => openSession(e, id)}
      className="hover:text-foreground underline-offset-2 hover:underline"
    >
      {name}
    </a>
  );
}

function Row({
  id,
  kind,
  head,
  body,
  at,
  tone,
}: {
  id: string;
  kind: ChatOriginKind;
  head: React.ReactNode;
  body: string;
  at: number;
  tone?: "decision";
}) {
  const [open, setOpen] = useRowState(`event:${id}`, false);
  const Icon = ICON[kind];
  const long = body.length > SHORT || body.includes("\n");
  return (
    <div
      data-origin={kind}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs",
        tone === "decision"
          ? "bg-foreground/[0.05] text-foreground/90"
          : "text-muted-foreground"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          tone === "decision" ? "text-primary" : "text-muted-foreground/70"
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0">{head}</span>
          {!open && (
            <span className="min-w-0 flex-1 truncate">
              {body.split("\n")[0]}
            </span>
          )}
          {open && <span className="flex-1" />}
          <time
            dateTime={new Date(at).toISOString()}
            className="text-muted-foreground/60 shrink-0 font-mono text-[10px]"
          >
            {clock(at)}
          </time>
        </div>
        {open && (
          <p className="mt-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
            {body}
          </p>
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
          className="hover:text-foreground -my-1.5 -mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open && "rotate-90"
            )}
          />
        </button>
      )}
    </div>
  );
}

// A message the reader didn't type: a compact row, not their bubble. The
// reader's own answers to asks in it show as their decisions.
export function EventRow({
  item,
  origin,
}: {
  item: UserItem;
  origin: ChatOrigin;
}) {
  const { body, decided } = eventParts(item, origin);
  const decision = origin.kind === "decision";
  return (
    <div className="flex flex-col gap-1">
      {decided.map((d, i) => (
        <Row
          key={i}
          id={`${item.id}:${i}`}
          kind="decision"
          tone="decision"
          head={<span className="font-medium">Saad decided</span>}
          body={d}
          at={item.createdAt}
        />
      ))}
      {body && (
        <Row
          id={item.id}
          kind={origin.kind}
          tone={decision ? "decision" : undefined}
          head={
            decision ? (
              <span className="font-medium">Saad decided</span>
            ) : (
              <Source origin={origin} />
            )
          }
          body={body}
          at={item.createdAt}
        />
      )}
    </div>
  );
}

// A user turn: the reader's bubble when they typed it, a row when not.
export function UserTurn({
  item,
  onUndo,
}: {
  item: UserItem;
  onUndo?: () => void;
}) {
  const origin = originOf(item);
  if (origin) return <EventRow item={item} origin={origin} />;
  return <UserMessage item={item} onUndo={onUndo} />;
}
