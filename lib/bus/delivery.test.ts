import { describe, it, expect } from "vitest";
import {
  busy,
  deliverToPane,
  holds,
  inputText,
  menuShown,
  type Pane,
} from "./delivery";
import { wakeLine } from "./format";

const RULE = "─".repeat(40);
const LINE = wakeLine({
  fromName: "orchestrator",
  fromId: "a",
  body: "please rebase on main and push",
});

// A stand-in for Claude Code in a tmux pane: an input box between two
// rules, a busy footer, and the ways typing has been seen to go wrong.
class FakeClaude implements Pane {
  input = "";
  transcript: string[] = [];
  queued: string[] = [];
  keys: string[] = [];
  constructor(
    public o: {
      busy?: boolean;
      menu?: boolean;
      inMode?: boolean;
      stuckMode?: boolean;
      typeLost?: boolean;
      pasteLost?: boolean;
      // Enters read as a newline inside the paste before one submits.
      swallowEnters?: number;
    } = {}
  ) {}
  async view() {
    const body = this.o.menu
      ? ["Do you want to proceed?", "❯ 1. Yes", "  2. No", "Esc to cancel"]
      : [
          // As Claude Code 2.1 draws it: a working line above the box, and
          // a hint in the empty box while a message is held.
          ...(this.o.busy ? ["✽ Flibbertigibbeting… (9s · ↓ 301 tokens)"] : []),
          RULE,
          `❯ ${this.input || (this.queued.length ? "Press up to edit queued messages" : "")}`,
          RULE,
        ];
    const footer = "  ⏵⏵ bypass permissions on";
    return {
      // Padded below, like a tall tmux pane.
      text: [
        ...this.transcript,
        ...this.queued,
        ...body,
        footer,
        ...Array(25).fill(""),
      ].join("\n"),
      cursorY: null,
      inMode: !!this.o.inMode,
    };
  }
  async type(text: string) {
    this.keys.push("type");
    if (!this.o.typeLost) this.input += text;
  }
  async paste(text: string) {
    this.keys.push("paste");
    if (!this.o.pasteLost) this.input += text;
  }
  async enter() {
    this.keys.push("enter");
    if ((this.o.swallowEnters ?? 0) > 0) {
      this.o.swallowEnters!--;
      this.input += "\n";
      return;
    }
    const text = this.input.trim();
    this.input = "";
    if (!text) return;
    if (this.o.busy) this.queued.push(`  ${text}`);
    else {
      this.transcript.push(`> ${text}`);
      this.o.busy = true;
    }
  }
  async leaveMode() {
    this.keys.push("cancel");
    if (!this.o.stuckMode) this.o.inMode = false;
  }
}

const fast = { sleep: async () => {}, waitMs: 20, pollMs: 5 };

describe("deliverToPane", () => {
  it("delivers to an idle agent and leaves the input empty", async () => {
    const pane = new FakeClaude();
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "delivered",
    });
    expect(pane.input).toBe("");
    expect(pane.transcript).toEqual([`> ${LINE}`]);
    expect(pane.keys).toEqual(["type", "enter"]);
  });

  it("says queued when the agent was busy", async () => {
    const pane = new FakeClaude({ busy: true });
    expect(await deliverToPane(pane, LINE, fast)).toEqual({ state: "queued" });
    expect(pane.input).toBe("");
  });

  it("says queued when Claude shows it holding the message", async () => {
    const pane = new FakeClaude();
    // The turn starts between the look before typing and the Enter.
    pane.type = async (t) => {
      pane.keys.push("type");
      pane.input += t;
      pane.o.busy = true;
    };
    expect(await deliverToPane(pane, LINE, fast)).toEqual({ state: "queued" });
  });

  it("presses Enter again when the first one became a newline", async () => {
    const pane = new FakeClaude({ swallowEnters: 1 });
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "delivered",
    });
    expect(pane.keys).toEqual(["type", "enter", "enter"]);
  });

  it("fails, saying so, when Enter never sends the text", async () => {
    const pane = new FakeClaude({ swallowEnters: 5 });
    const r = await deliverToPane(pane, LINE, fast);
    expect(r).toEqual({
      state: "failed",
      why: "the text is in its input but Enter didn't send it; it goes out with the next message, so don't send it again",
    });
  });

  it("never presses Enter on a prompt that opened after the text went in", async () => {
    const pane = new FakeClaude();
    // The prompt opens in the pause before Enter.
    const r = await deliverToPane(pane, LINE, {
      ...fast,
      sleep: async () => void (pane.o.menu = true),
    });
    expect(r).toEqual({
      state: "failed",
      why: "a menu or prompt opened before Enter",
    });
    expect(pane.keys).toEqual(["type"]);
  });

  it("doesn't paste a second copy when typed text shows up late", async () => {
    const pane = new FakeClaude();
    let views = 0;
    let pending = "";
    const view = pane.view.bind(pane);
    pane.type = async (t) => {
      pane.keys.push("type");
      pending = t;
      views = 0;
    };
    pane.view = async () => {
      if (pending && ++views >= 6) {
        pane.input += pending;
        pending = "";
      }
      return view();
    };
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "delivered",
    });
    expect(pane.keys).toEqual(["type", "enter"]);
    expect(pane.transcript).toEqual([`> ${LINE}`]);
  });

  it("pastes when typed keys never reach the input", async () => {
    const pane = new FakeClaude({ typeLost: true });
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "delivered",
    });
    expect(pane.keys).toEqual(["type", "paste", "enter"]);
  });

  it("fails when neither typing nor pasting reaches the input", async () => {
    const pane = new FakeClaude({ typeLost: true, pasteLost: true });
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "failed",
      why: "the text never showed up in its input (typed, then pasted)",
    });
    expect(pane.keys).toEqual(["type", "paste"]);
  });

  it("never types into a menu", async () => {
    const pane = new FakeClaude({ menu: true });
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "failed",
      why: "it is showing a menu or prompt waiting for an answer",
    });
    expect(pane.keys).toEqual([]);
  });

  it("stops when a menu opens as the text is typed, without pasting", async () => {
    const pane = new FakeClaude();
    pane.type = async () => {
      pane.keys.push("type");
      pane.o.menu = true;
    };
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "failed",
      why: "a menu opened as the text was typed",
    });
    expect(pane.keys).toEqual(["type"]);
  });

  it("leaves copy mode first, and fails if it can't", async () => {
    const scrolled = new FakeClaude({ inMode: true });
    expect(await deliverToPane(scrolled, LINE, fast)).toEqual({
      state: "delivered",
    });
    expect(scrolled.keys[0]).toBe("cancel");

    const stuck = new FakeClaude({ inMode: true, stuckMode: true });
    expect(await deliverToPane(stuck, LINE, fast)).toEqual({
      state: "failed",
      why: "its pane is scrolled back (copy mode)",
    });
    expect(stuck.keys).toEqual(["cancel"]);
  });

  it("sends an earlier message left unsent before typing the new one", async () => {
    const pane = new FakeClaude();
    const earlier = wakeLine({ fromName: "x", fromId: "b", body: "earlier" });
    pane.input = `${earlier}\n`;
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "queued",
    });
    expect(pane.transcript).toEqual([`> ${earlier}`]);
    expect(pane.queued).toEqual([`  ${LINE}`]);
  });

  it("stops when an earlier message won't send, without typing over it", async () => {
    const pane = new FakeClaude({ swallowEnters: 5 });
    pane.input = wakeLine({ fromName: "x", fromId: "b", body: "earlier" });
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "failed",
      why: "an earlier message is stuck unsent in its input",
    });
    expect(pane.keys).toEqual(["enter"]);
  });

  it("verifies a CLI without an input box by the cursor's line", async () => {
    let line = "";
    let cursorY = 1;
    const out = ["$ codex"];
    const pane: Pane = {
      view: async () => ({
        text: [...out, `› ${line}`].join("\n"),
        cursorY,
        inMode: false,
      }),
      type: async (t) => void (line += t),
      paste: async (t) => void (line += t),
      enter: async () => {
        out.push(`› ${line}`, "thinking...");
        line = "";
        cursorY = out.length;
      },
      leaveMode: async () => {},
    };
    expect(await deliverToPane(pane, LINE, fast)).toEqual({
      state: "delivered",
    });
  });
});

describe("pane reading", () => {
  it("reads Claude's input box between the last two rules", () => {
    const text = ["old", RULE, "❯ hello", "  world", RULE, "footer"].join("\n");
    expect(inputText({ text, cursorY: null, inMode: false })).toBe(
      "hello\n  world"
    );
  });

  it("matches wrapped and collapsed input", () => {
    const wrapped = `${LINE.slice(0, 30)}\n  ${LINE.slice(30)}`;
    expect(holds(wrapped, LINE)).toBe(true);
    expect(holds("[Pasted text #1 +2 lines]", LINE)).toBe(true);
    expect(holds("", LINE)).toBe(false);
  });

  it("knows a menu and a busy agent when it sees one", () => {
    expect(menuShown("Do you want to proceed?\n❯ 1. Yes\n  2. No")).toBe(true);
    expect(menuShown(`${RULE}\n❯ \n${RULE}\n? for shortcuts`)).toBe(false);
    expect(busy("✻ Thinking… (esc to interrupt)")).toBe(true);
    expect(busy("✽ Flibbertigibbeting… (9s · ↓ 301 tokens)")).toBe(true);
    expect(busy("? for shortcuts")).toBe(false);
    // A tall pane: the menu sits above rows of blank padding.
    const padded = `Do you want to proceed?\n❯ 1. Yes\n  2. No${"\n".repeat(30)}`;
    expect(menuShown(padded)).toBe(true);
    expect(busy(`✻ Working… (esc to interrupt)${"\n".repeat(30)}`)).toBe(true);
  });
});
