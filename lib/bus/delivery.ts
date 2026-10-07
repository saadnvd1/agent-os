// Typing a message into an agent's terminal and checking it actually went
// in. Typing can fail quietly: the text lands in a menu, or it reaches the
// input but Enter arrives inside the paste and becomes a newline, leaving
// it unsent. So each step is checked against what the pane shows.

import { WORKING_LINE } from "../claude-working-line";

export type DeliveryState = "delivered" | "queued" | "failed";
export type Delivery =
  | { state: "delivered" | "queued" }
  | { state: "failed"; why: string };

export interface PaneView {
  text: string;
  // Row of the cursor in `text`, when known.
  cursorY: number | null;
  // Scrolled back (copy mode): keys go to tmux, not the agent.
  inMode: boolean;
}

export interface Pane {
  view(): Promise<PaneView>;
  type(text: string): Promise<void>;
  paste(text: string): Promise<void>;
  enter(): Promise<void>;
  leaveMode(): Promise<void>;
}

const RULE = /^\s*[─━]{8,}/;

// The last n lines with text: a tall pane pads its bottom with blank ones.
const bottom = (text: string, n: number) =>
  text.replace(/\s+$/, "").split("\n").slice(-n).join("\n");
const squash = (s: string) => s.replace(/\s+/g, "");

// What sits in the agent's input box: between Claude Code's last two rules,
// or for other CLIs the cursor's line and the one above it.
export function inputText(v: PaneView): string {
  const lines = v.text.split("\n");
  const rules = lines.flatMap((l, i) => (RULE.test(l) ? [i] : []));
  if (rules.length >= 2) {
    const [a, b] = rules.slice(-2);
    return lines
      .slice(a + 1, b)
      .join("\n")
      .replace(/^\s*[❯>›]\s?/gm, "");
  }
  const at =
    v.cursorY ?? lines.map((l) => l.trim()).findLastIndex((l) => l !== "");
  return at < 0 ? "" : lines.slice(Math.max(0, at - 1), at + 1).join("\n");
}

// The start and end of the line: wrapping and collapsing never split both.
export function holds(input: string, line: string): boolean {
  const s = squash(input);
  if (/\[Pastedtext#\d+/.test(s)) return true;
  const l = squash(line);
  return s.includes(l.slice(0, 40)) || s.includes(l.slice(-40));
}

const MARKER = "[AgentOSmessagefrom";

// A choice is on screen (permission prompt, picker): typed text would
// answer it.
export function menuShown(text: string): boolean {
  return /Enter to (select|confirm|continue)|Esc to (cancel|go back|exit)|↑\/?↓ to (navigate|select)|Do you want to (proceed|make this edit|create|allow)|^\s*❯\s*\d+\.\s/im.test(
    bottom(text, 20)
  );
}

export function busy(text: string): boolean {
  const end = bottom(text, 15);
  return (
    WORKING_LINE.test(end) || /esc to interrupt|ctrl\+c to interrupt/i.test(end)
  );
}

// Claude Code says so when it holds a message for after the turn.
export function showsQueued(text: string): boolean {
  return /queued messages?|to send now/i.test(bottom(text, 15));
}

export interface DeliverOpts {
  sleep?: (ms: number) => Promise<void>;
  // How long to watch for each step to show.
  waitMs?: number;
  pollMs?: number;
}

type Attempt = "submitted" | "not-typed" | "stuck";

export async function deliverToPane(
  pane: Pane,
  line: string,
  opts: DeliverOpts = {}
): Promise<Delivery> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const waitMs = opts.waitMs ?? 2000;
  const pollMs = opts.pollMs ?? 150;

  const until = async (ok: (v: PaneView) => boolean): Promise<boolean> => {
    for (let t = 0; ; t += pollMs) {
      if (ok(await pane.view())) return true;
      if (t >= waitMs) return false;
      await sleep(pollMs);
    }
  };
  const inInput = (v: PaneView) => holds(inputText(v), line);

  let v = await pane.view();
  if (v.inMode) {
    await pane.leaveMode();
    v = await pane.view();
    if (v.inMode)
      return { state: "failed", why: "its pane is scrolled back (copy mode)" };
  }
  if (menuShown(v.text))
    return {
      state: "failed",
      why: "it is showing a menu or prompt waiting for an answer",
    };

  // An earlier message left unsent in the input goes first.
  if (squash(inputText(v)).includes(MARKER)) {
    await pane.enter();
    if (!(await until((x) => !squash(inputText(x)).includes(MARKER))))
      return {
        state: "failed",
        why: "an earlier message is stuck unsent in its input",
      };
    v = await pane.view();
  }
  const wasBusy = busy(v.text);

  const attempt = async (put: (t: string) => Promise<void>) => {
    await put(line);
    if (!(await until(inInput))) return "not-typed" as Attempt;
    // Enter straight after the text can be read as part of the paste.
    await sleep(pollMs);
    for (let i = 0; i < 2; i++) {
      await pane.enter();
      if (await until((x) => !inInput(x))) return "submitted" as Attempt;
    }
    return "stuck" as Attempt;
  };

  let result = await attempt((t) => pane.type(t));
  if (result === "not-typed") {
    const after = await pane.view();
    if (menuShown(after.text))
      return { state: "failed", why: "a menu opened as the text was typed" };
    result = await attempt((t) => pane.paste(t));
  }
  if (result === "not-typed")
    return {
      state: "failed",
      why: "the text never showed up in its input (typed, then pasted)",
    };
  if (result === "stuck")
    return {
      state: "failed",
      why: "the text is in its input but Enter didn't send it",
    };
  // Busy when it went in, or Claude says it's holding it: queued for
  // after this turn.
  const after = await pane.view();
  return { state: wasBusy || showsQueued(after.text) ? "queued" : "delivered" };
}
