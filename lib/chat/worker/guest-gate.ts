/**
 * The guest gate. A turn a live guest started (Drive) runs only what the
 * host taps for, whatever the session's access, its allow rules or No
 * approvals mode say: reading non-secret files inside the task's worktree is
 * the one thing that goes ahead alone. It is a PreToolUse hook, first in
 * line, so it decides before any permission rule could allow a call.
 *
 * The steer is sticky: set when a guest's message goes to the agent, and
 * cleared only when the host's own message starts a turn. Every turn in
 * between (a background task's follow-up too) is gated.
 */

import fs from "fs";
import path from "path";
import type {
  HookCallback,
  HookJSONOutput,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatItem, SentBy } from "../events";
import { isSecretPath } from "../../secret-paths";
import { deleteQueuedWhere } from "../queued";

export const GUEST_MAX_TOOL_CALLS = 40;
export const GUEST_TURN_MS = 20 * 60_000;

const NOT_ALLOWED = "The host didn't allow this step.";

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

// Typed by the host, or their own tap on something (a guest's suggestion,
// a plan they carried out, their phone). Agents, events and schedules
// aren't the host speaking, so they leave a steer as it is.
const byHost = (m: SentBy): boolean =>
  !m.from &&
  !m.peer &&
  (!m.origin || ["guest", "decision", "device"].includes(m.origin.kind));

export class GuestGate {
  steer: GuestSteer | null = null;
  // Wheels whose Drive is over: nothing sent under them is taken in.
  private released = new Set<string>();
  private timer?: NodeJS.Timeout;
  private asking = new Set<AbortController>();

  constructor(
    // Stops the running turn, with a line for the host saying why.
    private onStop: (note: ChatItem) => void
  ) {}

  /** A message goes to the agent; `midTurn`: it joined a running turn. */
  onSend(m: SentBy, midTurn: boolean): void {
    if (isGuestDrive(m)) {
      const o = m.origin!;
      this.steer = {
        shareId: o.share ?? "",
        wheel: o.wheel ?? "",
        guestId: o.guestId ?? "",
        name: o.label,
        toolCalls: 0,
        startedAt: Date.now(),
      };
      clearTimeout(this.timer);
      this.timer = setTimeout(
        () => this.stop(`${o.label}'s turn ran for 20 minutes`),
        GUEST_TURN_MS
      );
      this.timer.unref?.();
    } else if (!midTurn && byHost(m)) {
      this.steer = null;
      clearTimeout(this.timer);
    }
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
  return async (input, toolUseID, { signal }) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const steer = gate.steer;
    if (!steer) return {};
    if (!gate.count())
      return decide("deny", { reason: "This guest's turn is out of steps." });
    const name = input.tool_name;
    const args = (input.tool_input ?? {}) as Record<string, unknown>;
    if (HOST_CARDS.has(name)) return {};
    const id = toolUseID ?? input.tool_use_id;
    if (worktreeRead(name, args, cwd)) {
      approvals.passed(id);
      return decide("allow", { updatedInput: args });
    }
    // The card expires (denied) when the turn stops or the Drive ends.
    const ac = new AbortController();
    const abort = () => ac.abort();
    if (signal.aborted) ac.abort();
    signal.addEventListener("abort", abort, { once: true });
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
      untrack();
      signal.removeEventListener("abort", abort);
    }
  };
}

/**
 * Reads that need no tap: Read, Glob and Grep whose target resolves (links
 * followed) inside the worktree, outside .git, and is no secret file; and
 * TodoWrite. A Grep over a folder must be narrowed to a file type, so it
 * can't search an env file for a key.
 */
export function worktreeRead(
  name: string,
  args: Record<string, unknown>,
  cwd: string
): boolean {
  if (name === "TodoWrite") return true;
  if (name !== "Read" && name !== "Glob" && name !== "Grep") return false;
  let root: string;
  try {
    root = fs.realpathSync(cwd);
  } catch {
    return false;
  }
  const target = name === "Read" ? args.file_path : (args.path ?? cwd);
  if (typeof target !== "string" || !target) return false;
  const real = inside(root, cwd, target);
  if (!real) return false;
  if (name === "Read") return real.file;
  if (name === "Glob") return safePattern(args.pattern);
  if (real.file) return true;
  if (args.glob !== undefined && !safePattern(args.glob)) return false;
  return narrowed(args);
}

function inside(
  root: string,
  cwd: string,
  target: string
): { file: boolean } | null {
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
  if (rel.split(path.sep).includes(".git")) return null;
  if ((rel && isSecretPath(rel)) || isSecretPath(real)) return null;
  if (!stat.isFile() && !stat.isDirectory()) return null;
  return { file: stat.isFile() };
}

// A pattern that stays below its folder.
function safePattern(p: unknown): boolean {
  return (
    typeof p === "string" &&
    !!p &&
    !path.isAbsolute(p) &&
    !p.startsWith("~") &&
    !p.split(/[\\/]/).includes("..")
  );
}

const SECRET_EXT = /^(env|pem|key|p12|pfx|npmrc|netrc|pgpass)$/i;

// Only files of one type, or of named extensions, none of them secret ones.
function narrowed(args: Record<string, unknown>): boolean {
  const type = args.type;
  if (typeof type === "string")
    return (
      /^[a-z0-9]+$/i.test(type) && type !== "all" && !SECRET_EXT.test(type)
    );
  const glob = args.glob;
  if (typeof glob !== "string") return false;
  const m = /^(?:\*\*\/)?\*\.(?:([a-z0-9]+)|\{([a-z0-9,]+)\})$/i.exec(glob);
  if (!m) return false;
  return (m[1] ?? m[2])
    .split(",")
    .every((ext) => !!ext && !SECRET_EXT.test(ext));
}
