// What a thread card in a lead's chat shows: the two leads, the last
// exchange up to the message the card stands for, the pins each message
// cites (the owner's words, as the server copied them), and where the
// thread stands. The text is the leads' own; the chat draws it as text.

import { z } from "zod";
import { experimentOn } from "../experiments";
import { openBySubject } from "../orchestrator/asks";
import { AREA_THREAD } from "./area-notify";
import { getPin } from "./direction";
import { leadTitle } from "./home";
import { threadAskSubject } from "./mail";
import { threadUpTo } from "./messages";
import { hasLeads } from "./settings";
import type { LeadKind } from "./types";

const SHOWN = 2;
const ALL = 50;

export interface ThreadMember {
  kind: LeadKind;
  title: string;
}

export interface ThreadMessageView {
  id: number;
  from: ThreadMember;
  to: ThreadMember;
  text: string;
  at: string;
  pins: { id: number; quote: string; setAt: string }[];
}

export type ThreadState =
  // The loop guard held it: it waits on the owner's ask.
  | { kind: "held"; askId: number }
  | { kind: "waiting"; on: ThreadMember }
  // AgentOS's notices of work started in a lead's area.
  | { kind: "notice" };

export interface LeadThreadView {
  thread: string;
  // Who wrote first, then the other.
  members: [ThreadMember, ThreadMember];
  messages: ThreadMessageView[];
  // In the whole thread, and after the message the card stands for.
  total: number;
  later: number;
  state: ThreadState;
}

export const ThreadQuery = z.object({
  workspaceId: z.string().min(1).max(100),
  thread: z.string().min(1).max(200),
  // The two leads, as the card's mail names them.
  a: z.string().min(1).max(32),
  b: z.string().min(1).max(32),
  upTo: z.coerce.number().int().positive().optional(),
  all: z.enum(["1"]).optional(),
});

export function threadView(
  q: z.infer<typeof ThreadQuery>
): LeadThreadView | null {
  if (!experimentOn("leads") || !hasLeads(q.workspaceId)) return null;
  const w = q.workspaceId;
  const pair = { workspaceId: w, thread: q.thread, a: q.a, b: q.b };
  const read = threadUpTo({
    ...pair,
    upToId: q.upTo ?? null,
    limit: q.all ? ALL : SHOWN,
  });
  const { total, later, opened } = read;
  // The last exchange: a message and the other lead's one it answers, or
  // just the message when the one before it was its own.
  const messages =
    !q.all &&
    read.messages.length === 2 &&
    read.messages[0].fromKind === read.messages[1].fromKind
      ? read.messages.slice(1)
      : read.messages;
  if (!messages.length || !opened) return null;
  // Where the thread stands now, whatever message the card is.
  const latest = later
    ? threadUpTo({ ...pair, upToId: null, limit: 1 }).messages[0]
    : messages.at(-1)!;
  const titles = new Map<LeadKind, ThreadMember>();
  const member = (kind: LeadKind) => {
    if (!titles.has(kind))
      titles.set(kind, { kind, title: leadTitle(w, kind) });
    return titles.get(kind)!;
  };
  const held = openBySubject(w, threadAskSubject(q.a, q.b, q.thread));
  return {
    thread: q.thread,
    members: [member(opened.from), member(opened.to)],
    messages: messages.map((m) => ({
      id: m.id,
      from: member(m.fromKind),
      to: member(m.toKind),
      text: m.text,
      at: m.createdAt,
      pins: m.pins.flatMap((id) => {
        const p = getPin(id);
        return p ? [{ id: p.id, quote: p.quote, setAt: p.setAt }] : [];
      }),
    })),
    total,
    later,
    state: held
      ? { kind: "held", askId: held.id }
      : q.thread === AREA_THREAD
        ? { kind: "notice" }
        : { kind: "waiting", on: member(latest.toKind) },
  };
}
