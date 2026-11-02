"use client";

import { ChevronRight } from "lucide-react";
import { LeadAvatar } from "@/components/SessionList/RowParts";
import { ShimmeringLoader } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { useRowState } from "@/components/Chat/rowState";
import { StatusIcon, useToolBody } from "@/components/Chat/Tools";
import type { ToolItem } from "@/lib/chat/group";
import { useLeadThread } from "@/data/leads";
import { useOwnerName } from "@/data/client-config/queries";
import { memberLetter } from "@/lib/leads/order";
import { ownerInUi } from "@/lib/owner-label";
import type {
  LeadThreadView,
  ThreadMember,
  ThreadMessageView,
} from "@/lib/leads/thread-view";
import { cn } from "@/lib/utils";
import { pinDate, useDirectionChat } from "./direction-context";

export interface MailRef {
  thread: string;
  from: string;
  to: string;
  // The message the card stands for; the thread's latest without one.
  id?: number;
}

// Words that claim the owner's say-so. Without a pin cited, the card marks
// such a message unattested, as the receiving lead is told.
const CLAIMS_APPROVAL = /\b(approved|signed off|green[- ]?lit|ok'?d)\b/i;

const short = (title: string) => title.replace(/ lead$/i, "");

function Avatar({ m }: { m: Pick<ThreadMember, "kind" | "title"> }) {
  return (
    <LeadAvatar
      member={{ kind: m.kind, title: m.title, letter: memberLetter(m.kind) }}
    />
  );
}

function StatePill({ view }: { view: LeadThreadView }) {
  const s = view.state;
  if (s.kind === "held")
    return (
      <StatusPill tone="amber" title={`Held for your answer (ask ${s.askId})`}>
        held · ask {s.askId}
      </StatusPill>
    );
  if (s.kind === "notice") return <StatusPill tone="muted">notice</StatusPill>;
  return <StatusPill tone="primary">waiting on {short(s.on.title)}</StatusPill>;
}

function Line({ m }: { m: ThreadMessageView }) {
  const you = ownerInUi(useOwnerName());
  const unattested = !m.pins.length && CLAIMS_APPROVAL.test(m.text);
  return (
    <div className="flex min-w-0 gap-2 py-0.5">
      <span className="text-foreground/90 shrink-0 font-semibold">
        {short(m.from.title)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-foreground/80 [overflow-wrap:anywhere] whitespace-pre-wrap">
          {m.text}
        </p>
        {(m.pins.length > 0 || unattested) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.pins.map((p) => (
              <StatusPill
                key={p.id}
                tone="primary"
                title={`“${p.quote}” — pinned by ${you}`}
              >
                pin #{p.id} · {you}, {pinDate(p.setAt)}
              </StatusPill>
            ))}
            {unattested && (
              <StatusPill
                tone="amber"
                title="It cites no pinned direction, so this isn't your word"
              >
                unattested
              </StatusPill>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Body({
  mail,
  workspaceId,
  fallback,
}: {
  mail: MailRef;
  workspaceId: string;
  fallback: React.ReactNode;
}) {
  const key = `thread:${mail.from}:${mail.to}:${mail.thread}:${mail.id ?? "last"}`;
  const [all, setAll] = useRowState(key, false);
  const q = {
    workspaceId,
    thread: mail.thread,
    a: mail.from,
    b: mail.to,
    upTo: mail.id,
  };
  const { data: view, isPending } = useLeadThread(q, all);
  if (isPending)
    return (
      <Card mail={mail}>
        <div className="flex flex-col gap-1.5 py-1">
          <ShimmeringLoader className="h-3 w-2/3" />
          <ShimmeringLoader className="h-3 w-1/2" delayIndex={1} />
        </div>
      </Card>
    );
  if (!view) return <>{fallback}</>;
  const [a, b] = view.members;
  const hidden = view.total - view.later - view.messages.length;
  return (
    <Card mail={mail}>
      <div className="text-muted-foreground mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <Avatar m={a} />
        <span aria-hidden>→</span>
        <Avatar m={b} />
        <span className="text-foreground/80 min-w-0 truncate font-medium">
          {short(a.title)} ↔ {short(b.title)} · {view.thread}
        </span>
        <span className="ml-auto">
          <StatePill view={view} />
        </span>
      </div>
      {view.messages.map((m) => (
        <Line key={m.id} m={m} />
      ))}
      {(hidden > 0 || view.later > 0 || all) && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className="text-muted-foreground hover:text-foreground -mx-1 -mb-1 flex min-h-11 items-center gap-1 rounded-md px-1 md:min-h-8"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              all && "rotate-90"
            )}
            aria-hidden
          />
          {all
            ? "Show the last exchange"
            : `Show all ${view.total} on this thread${view.later ? ` (${view.later} later)` : ""}`}
        </button>
      )}
    </Card>
  );
}

function Card({
  mail,
  children,
}: {
  mail: MailRef;
  children: React.ReactNode;
}) {
  return (
    <div
      data-lead-thread={mail.thread}
      className="bg-foreground/[0.03] rounded-lg px-2.5 py-2 text-xs shadow-sm"
    >
      {children}
    </div>
  );
}

// A thread between two leads, inline in either lead's chat: who wrote to
// whom, the last exchange up to this message, the pins each cites and where
// the thread stands. Outside a lead chat it's the plain text.
export function ThreadCard({
  mail,
  fallback,
}: {
  mail: MailRef;
  fallback: React.ReactNode;
}) {
  const chat = useDirectionChat();
  if (!chat) return <>{fallback}</>;
  return (
    <Body mail={mail} workspaceId={chat.view.workspaceId} fallback={fallback} />
  );
}

const SENT = /mail #(\d+) on thread "([^"\n]+)"/;

// The lead's own message_lead call, drawn as the thread it went to. Until
// it's sent, and when it was refused or held, it's the call's own line.
export function MailToolCard({ tool }: { tool: ToolItem }) {
  const chat = useDirectionChat();
  const body = useToolBody(tool);
  const input = (tool.input ?? {}) as { to?: unknown; thread?: unknown };
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  const sent = SENT.exec(body?.output ?? "");
  const line = (
    <div className="text-muted-foreground flex min-h-9 items-center gap-2 px-2.5 text-xs">
      <StatusIcon status={tool.status} />
      <span className="line-clamp-2 min-w-0 flex-1">
        {tool.status === "running"
          ? `Writing to the ${to || "other"} lead…`
          : (body?.output ?? tool.title)}
      </span>
    </div>
  );
  if (!chat || !sent || !to) return line;
  return (
    <ThreadCard
      mail={{
        thread: sent[2],
        from: chat.view.kind,
        to,
        id: Number(sent[1]),
      }}
      fallback={line}
    />
  );
}
