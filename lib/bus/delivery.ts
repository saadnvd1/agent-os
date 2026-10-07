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

  // Every Enter looks first: a prompt that opened since the last look would
  // take it as an answer.
  const MENU_OPENED = "a menu or prompt opened before Enter";
  const safeEnter = async (): Promise<boolean> => {
    const now = await pane.view();
    if (now.inMode || menuShown(now.text)) return false;
    await pane.enter();
    return true;
  };
  const ours = (x: PaneView) => squash(inputText(x)).includes(MARKER);

  // An earlier message left unsent in the input goes first.
  if (ours(v)) {
    if (!(await safeEnter())) return { state: "failed", why: MENU_OPENED };
    if (!(await until((x) => !ours(x))))
      return {
        state: "failed",
        why: "an earlier message is stuck unsent in its input",
      };
    v = await pane.view();
  }
  const wasBusy = busy(v.text);

  // Any failure from here may leave this message in the input, where the
  // next delivery sends it: say so, or a resend reaches the agent twice.
  const failed = async (why: string, left = false): Promise<Delivery> => ({
    state: "failed",
    why:
      left || ours(await pane.view())
        ? `${why}; it is left in its input and goes out with the next message, so don't send it again`
        : why,
  });

  await pane.type(line);
  if (!(await until(inInput))) {
    const after = await pane.view();
    if (menuShown(after.text))
      return failed("a menu opened as the text was typed");
    // Typed text that shows up late must not get a pasted twin.
    if (!ours(after)) {
      await pane.paste(line);
      if (!(await until(inInput)))
        return failed(
          "the text never showed up in its input (typed, then pasted)"
        );
    } else if (!(await until(inInput)))
      return failed("only part of the text reached its input");
  }

  // Enter straight after the text can be read as part of the paste.
  await sleep(pollMs);
  let sent = false;
  for (let i = 0; i < 2 && !sent; i++) {
    // The text was seen in the input; a menu over it hides it, not clears it.
    if (!(await safeEnter())) return failed(MENU_OPENED, true);
    sent = await until((x) => !inInput(x));
  }
  // The last look still had it in the input, even collapsed as a paste.
  if (!sent) return failed("Enter didn't send it", true);
  // Busy when it went in, or Claude says it's holding it: queued for
  // after this turn.
  const after = await pane.view();
  return {
    state: wasBusy || showsQueued(after.text) ? "queued" : "delivered",
  };
}
