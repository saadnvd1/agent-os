/**
 * The guest gate. A turn a live guest started (Drive) runs only what the
 * host taps for, whatever the session's access, its allow rules or No
 * approvals mode say: reading non-secret files inside the task's worktree is
 * the one thing that goes ahead alone. It is a PreToolUse hook, first in
 * line, so it decides before any permission rule could allow a call.
 *
 * The steer is sticky: set when a guest's message goes to the agent, and
 * cleared only when a message the host sent themselves starts its turn.
 * Every turn in between (a background task's follow-up, the wind-down of a
 * stopped one) is gated. It is kept on the session (chat_guest_steers), so
 * a worker that restarts picks it up.
 */

import fs from "fs";
import path from "path";
import type {
  HookCallback,
  HookJSONOutput,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatItem, SentBy } from "../events";
import { db } from "../../db";
import { isSecretPath } from "../../secret-paths";
import { readPlaced } from "../../worktree-placed";
import { deleteQueuedWhere } from "../queued";

export const GUEST_MAX_TOOL_CALLS = 40;
export const GUEST_TURN_MS = 20 * 60_000;

const NOT_ALLOWED = "The host didn't allow this step.";
const FAILED = "The guest gate failed, so this step didn't run.";
const OUT_OF_TIME = "This guest's turn is out of time.";

export interface GuestSteer {
  shareId: string;
  wheel: string;
  guestId: string;
  name: string;
  toolCalls: number;
  startedAt: number;
}

/** What the gate needs of the approval cards (lib/chat/drivers/claude-approvals). */
export interface GateApprovals {
  askGuest(
    toolName: string,
    input: Record<string, unknown>,
    toolUseID: string,
    signal: AbortSignal,
    guest: { name: string }
  ): Promise<PermissionResult>;
  /** The gate let this call through: the permission prompt that may follow is answered. */
  passed(toolUseID: string): void;
}

export const isGuestDrive = (m: SentBy): boolean =>
  m.origin?.kind === "guest-drive";

// Sent by the host themselves (their composer, their own taps). Agents,
// events, schedules and AgentOS's own resends aren't the host speaking, so
// they leave a steer as it is.
const byHost = (m: SentBy): boolean =>
  m.host === true && !m.from && !m.peer && !isGuestDrive(m);

type SteerRow = {
  share_id: string;
  wheel: string;
  guest_id: string;
  name: string;
  tool_calls: number;
  started_at: number;
};

function loadSteer(sessionId: string): GuestSteer | null {
  const r = db
    .prepare(`SELECT * FROM chat_guest_steers WHERE session_id = ?`)
    .get(sessionId) as SteerRow | undefined;
  return r
    ? {
        shareId: r.share_id,
        wheel: r.wheel,
        guestId: r.guest_id,
        name: r.name,
        toolCalls: r.tool_calls,
        startedAt: r.started_at,
      }
    : null;
}

function saveSteer(sessionId: string, s: GuestSteer | null): void {
  if (!s) {
    db.prepare(`DELETE FROM chat_guest_steers WHERE session_id = ?`).run(
      sessionId
    );
    return;
  }
  db.prepare(
    `INSERT OR REPLACE INTO chat_guest_steers (session_id, share_id, wheel, guest_id, name, tool_calls, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    s.shareId,
    s.wheel,
    s.guestId,
    s.name,
    s.toolCalls,
    s.startedAt
  );
}

export class GuestGate {
  steer: GuestSteer | null;
  // Wheels whose Drive is over: nothing sent under them is taken in.
  private released = new Set<string>();
  private timer?: NodeJS.Timeout;
  private asking = new Set<AbortController>();
  // Turns started, and the one (by count) the host's own message starts:
  // the steer ends when that one does.
  private starts = 0;
  private clearAt = 0;
  private placed?: Promise<Set<string>>;

  constructor(
    // Stops the running turn, with a line for the host saying why.
    private onStop: (note: ChatItem) => void,
    private sessionId?: string
  ) {
    this.steer = sessionId ? loadSteer(sessionId) : null;
    if (this.steer) this.arm(this.steer);
  }

  private set(s: GuestSteer | null): void {
    this.steer = s;
    if (!s) clearTimeout(this.timer);
    if (this.sessionId) saveSteer(this.sessionId, s);
  }

  private arm(s: GuestSteer): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.stop(`${s.name}'s turn ran for 20 minutes`),
      Math.max(0, s.startedAt + GUEST_TURN_MS - Date.now())
    );
    this.timer.unref?.();
  }

  /**
   * A message goes to the agent. `midTurn`: it joined a running turn;
   * `ahead`: turns that start before its own (one sent but not started).
   */
  onSend(m: SentBy, midTurn: boolean, ahead = 0): void {
    if (isGuestDrive(m)) {
      const o = m.origin!;
      const s: GuestSteer = {
        shareId: o.share ?? "",
        wheel: o.wheel ?? "",
        guestId: o.guestId ?? "",
        name: o.label,
        toolCalls: 0,
        startedAt: Date.now(),
      };
      this.set(s);
      this.arm(s);
      this.clearAt = 0;
    } else if (!midTurn && this.steer && byHost(m))
      this.clearAt = this.starts + ahead + 1;
  }

  /** The agent started a turn: the host's own message's turn ends a steer. */
  onTurnStart(): void {
    this.starts++;
    if (this.clearAt && this.starts >= this.clearAt) {
      this.clearAt = 0;
      this.set(null);
    }
  }

  /** Where a guest card stops waiting: the guest's 20 minutes are up. */
  deadline(): number {
    return (this.steer?.startedAt ?? 0) + GUEST_TURN_MS;
  }

  /** Files AgentOS copied into the worktree (env files, agentos.json `copy`). */
  placedFiles(cwd: string): Promise<Set<string>> {
    this.placed ??= readPlaced(cwd).then(
      (p) => new Set(Object.keys(p.files).map((f) => path.normalize(f)))
    );
    return this.placed;
  }

  /** A guest's message from a Drive that's over (or naming none). */
  refuses(m: SentBy): boolean {
    return (
      isGuestDrive(m) &&
      (!m.origin?.share || !m.origin.wheel || this.released.has(m.origin.wheel))
    );
  }

  /**
   * Ends a Drive: its queued prompts go, its pending cards expire as
   * denied, and later messages under that wheel are refused. A steer it
   * holds stays on (still gated) until the host's next message.
   */
  release(
    sessionId: string,
    share: string,
    wheel: string
  ): { purged: boolean; steered: boolean } {
    if (wheel) this.released.add(wheel);
    const purged =
      deleteQueuedWhere(
        sessionId,
        (by) => isGuestDrive(by) && by.origin?.share === share
      ).length > 0;
    const steered = this.steeredBy(share);
    if (steered) {
      clearTimeout(this.timer);
      this.clearAt = 0;
      this.expire();
    }
    return { purged, steered };
  }

  steeredBy(share: string, wheel?: string): boolean {
    return (
      !!share &&
      this.steer?.shareId === share &&
      (wheel === undefined || this.steer.wheel === wheel)
    );
  }

  /** The worker's guest_release and guest_stop. */
  command(
    cmd: { type: "guest_release" | "guest_stop"; share: string; wheel: string },
    sessionId: string,
    fx: { queueChanged: () => void; stopTurn: () => Promise<void> | void }
  ): Promise<void> | void {
    if (cmd.type === "guest_stop")
      return this.steeredBy(cmd.share, cmd.wheel) ? fx.stopTurn() : undefined;
    const { purged, steered } = this.release(sessionId, cmd.share, cmd.wheel);
    if (purged) fx.queueChanged();
    return steered ? fx.stopTurn() : undefined;
  }

  /** Counts a call of the steered turn; false past the cap, which stops it. */
  count(): boolean {
    const s = this.steer;
    if (!s) return true;
    s.toolCalls++;
    if (this.sessionId) saveSteer(this.sessionId, s);
    if (s.toolCalls <= GUEST_MAX_TOOL_CALLS) return true;
    if (s.toolCalls === GUEST_MAX_TOOL_CALLS + 1)
      this.stop(`${s.name}'s turn reached ${GUEST_MAX_TOOL_CALLS} steps`);
    return false;
  }

  track(ac: AbortController): () => void {
    this.asking.add(ac);
    return () => this.asking.delete(ac);
  }

  private expire(): void {
    for (const ac of this.asking) ac.abort();
    this.asking.clear();
  }

  private stop(why: string): void {
    clearTimeout(this.timer);
    this.expire();
    this.onStop({
      id: `note-guest-stop-${Date.now()}`,
      kind: "note",
      tone: "note",
      text: `Stopped: ${why}`,
      createdAt: Date.now(),
    });
  }

  close(): void {
    clearTimeout(this.timer);
    this.expire();
  }
}

// The agent's questions and plans are host cards already (their own hooks).
const HOST_CARDS = new Set(["AskUserQuestion", "ExitPlanMode"]);

const decide = (
  permissionDecision: "allow" | "deny",
  extra: { updatedInput?: Record<string, unknown>; reason?: string }
): HookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision,
    ...(extra.updatedInput && { updatedInput: extra.updatedInput }),
    ...(extra.reason && { permissionDecisionReason: extra.reason }),
  },
});

export function guestGateHook(
  approvals: GateApprovals,
  gate: GuestGate,
  cwd: string
): HookCallback {
  // Any failure denies: an error must never let a guest's step through.
  return async (input, toolUseID, opts) => {
    try {
      return await gateCall(approvals, gate, cwd, input, toolUseID, opts);
    } catch {
      return decide("deny", { reason: FAILED });
    }
  };
}

async function gateCall(
  approvals: GateApprovals,
  gate: GuestGate,
  cwd: string,
  ...[input, toolUseID, { signal }]: Parameters<HookCallback>
): Promise<HookJSONOutput> {
  if (input.hook_event_name !== "PreToolUse") return {};
  const steer = gate.steer;
  if (!steer) return {};
  if (!gate.count())
    return decide("deny", { reason: "This guest's turn is out of steps." });
  const name = input.tool_name;
  const args = (input.tool_input ?? {}) as Record<string, unknown>;
  if (HOST_CARDS.has(name)) return {};
  const id = toolUseID ?? input.tool_use_id;
  // What AgentOS copied in is read (git, so slowly) only for a read that
  // would otherwise go ahead.
  if (
    worktreeRead(name, args, cwd) &&
    worktreeRead(name, args, cwd, await gate.placedFiles(cwd))
  ) {
    approvals.passed(id);
    return decide("allow", { updatedInput: args });
  }
  // The card expires (denied) when the turn stops, the Drive ends or the
  // guest's 20 minutes run out, well before the SDK's own hook timeout.
  const left = gate.deadline() - Date.now();
  if (left <= 0) return decide("deny", { reason: OUT_OF_TIME });
  const ac = new AbortController();
  const abort = () => ac.abort();
  if (signal.aborted) ac.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, left);
  timer.unref?.();
  const untrack = gate.track(ac);
  try {
    const r = await approvals.askGuest(name, args, id, ac.signal, {
      name: steer.name,
    });
    if (r.behavior !== "allow")
      return decide("deny", { reason: r.message || NOT_ALLOWED });
    approvals.passed(id);
    return decide("allow", { updatedInput: r.updatedInput ?? args });
  } finally {
    clearTimeout(timer);
    untrack();
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Reads that need no tap: Read, Glob and Grep whose target resolves (links
 * followed) inside the worktree, outside .git, and is no secret file nor
 * one AgentOS copied in (`placed`); and TodoWrite. A Grep names its path
 * and, over a folder, is narrowed to a file type with no copied file under
 * it; one with a `glob` is a card (rg's --glob overrides --type and
 * .gitignore, so it could reach an env file).
 */
export function worktreeRead(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  placed: Set<string> = new Set()
): boolean {
  if (name === "TodoWrite") return true;
  if (name !== "Read" && name !== "Glob" && name !== "Grep") return false;
  let root: string;
  try {
    root = fs.realpathSync(cwd);
  } catch {
    return false;
  }
  if (name === "Grep" && (args.glob !== undefined || args.path === undefined))
    return false;
  const target = name === "Read" ? args.file_path : (args.path ?? cwd);
  if (typeof target !== "string" || !target) return false;
  const real = inside(root, cwd, target);
  if (!real) return false;
  const copied = real.file
    ? placed.has(real.rel)
    : [...placed].some((f) => !real.rel || f.startsWith(real.rel + path.sep));
  if (name === "Read") return real.file && !copied;
  if (name === "Glob") return safePattern(args.pattern);
  if (copied) return false;
  return real.file || narrowed(args);
}

// Secret by name, whatever isSecretPath says: every env file (env-setup
// copies them all in), Wrangler's, Terraform state, cloud keys.
const SECRET_NAME =
  /^(\.env.*|\.dev\.vars.*|.*\.tfstate(\..*)?|.*service[-_]?account.*\.json|credentials.*\.json|\.npmrc|\.netrc|\.pgpass)$/i;

function inside(
  root: string,
  cwd: string,
  target: string
): { file: boolean; rel: string } | null {
  let real: string;
  let stat: fs.Stats;
  try {
    real = fs.realpathSync(path.resolve(cwd, target));
    stat = fs.statSync(real);
  } catch {
    return null;
  }
  const rel = path.relative(root, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.includes(".git")) return null;
  if (parts.some((p) => SECRET_NAME.test(p))) return null;
  if ((rel && isSecretPath(rel)) || isSecretPath(real)) return null;
  if (!stat.isFile() && !stat.isDirectory()) return null;
  return { file: stat.isFile(), rel };
}

// A pattern that stays below its folder: no braces (which can list one).
function safePattern(p: unknown): boolean {
  return (
    typeof p === "string" &&
    !!p &&
    !path.isAbsolute(p) &&
    !p.startsWith("~") &&
    !/[{}]/.test(p) &&
    !p.includes("..")
  );
}

const SECRET_EXT = /^(env|pem|key|p12|pfx|npmrc|netrc|pgpass)$/i;

// Only files of one type, none of them a secret one.
function narrowed(args: Record<string, unknown>): boolean {
  const type = args.type;
  return (
    typeof type === "string" &&
    /^[a-z0-9]+$/i.test(type) &&
    type !== "all" &&
    !SECRET_EXT.test(type)
  );
}
