// Pure pieces of the agent bus: how a message is shown to the agent that
// receives it, and the guard against two agents replying forever.

export const HUMAN = "you";

export interface BusMessageView {
  id: number;
  fromId: string | null;
  fromName: string;
  toId: string;
  toName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

const INLINE_LIMIT = 600;

// Enough of a session id to address it (aos send takes a unique prefix).
export const shortId = (id: string) => id.slice(0, 8);

// Typed into the recipient's terminal. Long bodies are left for `aos inbox`.
export function wakeLine(m: {
  fromName: string;
  fromId: string | null;
  body: string;
}): string {
  const short = m.fromId ? shortId(m.fromId) : null;
  const who = short
    ? `"${m.fromName}" (${short})`
    : m.fromName === HUMAN
      ? "the user (via AgentOS)"
      : `${m.fromName} (via AgentOS)`;
  const oneLine = m.body.replace(/\s*\n\s*/g, " ").trim();
  const text =
    oneLine.length <= INLINE_LIMIT
      ? `: ${oneLine}`
      : ` (${m.body.length} chars). Read it with: aos inbox`;
  // By id: a reply can't break when either side is renamed.
  const reply = short ? ` Reply with: aos send ${short} "<message>"` : "";
  return `[AgentOS message from ${who}]${text}.${reply}`;
}

export const RATE_LIMIT = { max: 30, windowMs: 10 * 60 * 1000 };

// Messages between the same two sessions inside the window, either way.
export function overRateLimit(
  timestamps: number[],
  now = Date.now(),
  limit = RATE_LIMIT
): boolean {
  return timestamps.filter((t) => now - t < limit.windowMs).length >= limit.max;
}

// "fast-shadow", "dashboards/fast-shadow", or a session id all address one session.
export function matchesRef(
  ref: string,
  s: { id: string; name: string; projectName: string | null; tmuxName: string }
): boolean {
  const r = ref.trim().toLowerCase();
  const name = s.name.toLowerCase();
  return (
    r === s.id ||
    r === s.tmuxName.toLowerCase() ||
    r === name ||
    (!!s.projectName && r === `${s.projectName.toLowerCase()}/${name}`)
  );
}
