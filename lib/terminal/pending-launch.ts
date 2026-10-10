/**
 * A task's terminal opened before its agent launched: it shows the setup as
 * it moves, then attaches once the launch has happened. Woken by the setup's
 * own progress (lib/sessions/setup-progress), with a slow recheck for what
 * ends a launch without a word (a restart, the task closed).
 */

import { db } from "../db";
import { getSetup, watchSetup, type Stage } from "../sessions/setup-progress";
import { launchHold, launchPending } from "../tasks/start";

export const RECHECK_MS = 5000;
// Progress can move per command; the screen is redrawn at most this often.
const DRAW_MS = 150;
const LOG_LINES = 8;

// The session a tmux name belongs to on that machine (a mirror row for a
// linked one), so an attach that came without its id is still that session's.
export function sessionForTmux(
  hostId: string | undefined,
  tmuxName: string
): string | null {
  const row = db
    .prepare(
      `SELECT id FROM sessions WHERE tmux_name = ? AND COALESCE(host_id, 'local') = ?
       LIMIT 1`
    )
    .get(tmuxName, hostId || "local") as { id: string } | undefined;
  return row?.id ?? null;
}

const MARK: Record<Stage["state"], string> = {
  pending: "\x1b[2m·",
  running: "\x1b[33m›",
  ok: "\x1b[32m✓",
  failed: "\x1b[31m✗",
  skipped: "\x1b[2m–",
};

const cut = (line: string, cols: number) =>
  line.length > cols ? `${line.slice(0, Math.max(0, cols - 1))}…` : line;

export function renderPendingLaunch(sessionId: string, cols: number): string {
  const setup = getSetup(sessionId);
  const width = Math.max(10, cols - 2);
  const lines: string[] = [];
  const status = (
    db
      .prepare(`SELECT setup_status FROM sessions WHERE id = ?`)
      .get(sessionId) as { setup_status: string | null } | undefined
  )?.setup_status;
  const held = status === "held" ? launchHold(sessionId) : null;
  // The live view says when setup is over and the launch is under way.
  const settingUp = setup ? setup.status === "running" : status !== "held";
  lines.push(
    held
      ? `\x1b[1mHeld before launch\x1b[0m: ${held}. It starts once that clears.`
      : settingUp
        ? "\x1b[1mSetting up this task\x1b[0m. Its agent opens here once it starts."
        : "\x1b[1mStarting its agent...\x1b[0m"
  );
  if (setup?.branch) lines.push(`\x1b[2m${setup.branch}\x1b[0m`);
  if (setup?.stages.length) {
    lines.push("");
    for (const s of setup.stages)
      lines.push(`  ${MARK[s.state]} ${s.label}\x1b[0m`);
  }
  const log = setup?.log.slice(-LOG_LINES) ?? [];
  if (log.length) {
    lines.push("");
    for (const l of log) lines.push(`\x1b[2m  ${cut(l, width - 2)}\x1b[0m`);
  }
  return `\x1b[H\x1b[2J${lines.join("\r\n")}\r\n`;
}

/**
 * Draws its progress until the launch is no longer pending, then calls
 * `launched` once. Returns a cancel.
 */
export function waitForLaunch(
  sessionId: string,
  opts: {
    draw: (screen: string) => void;
    launched: () => void;
    cols: () => number;
  }
): () => void {
  let over = false;
  let drawTimer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    over = true;
    unwatch();
    clearInterval(recheck);
    if (drawTimer) clearTimeout(drawTimer);
    drawTimer = null;
  };
  const check = () => {
    if (over) return;
    if (!launchPending(sessionId)) {
      stop();
      opts.launched();
      return;
    }
    opts.draw(renderPendingLaunch(sessionId, opts.cols()));
  };
  const soon = () => {
    if (over || drawTimer) return;
    drawTimer = setTimeout(() => {
      drawTimer = null;
      check();
    }, DRAW_MS);
  };
  const unwatch = watchSetup(sessionId, soon);
  const recheck = setInterval(check, RECHECK_MS);
  recheck.unref?.();
  check();
  return stop;
}
