import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkBusyIndicators,
  checkWaitingPatterns,
  findQuestion,
  plainText,
  readInputBox,
  screenText,
  statusDetector,
  UNSENT_MS,
} from "./status-detector";

const pane = (working: string) =>
  [
    "⏺ Write(lib/db/stacks.ts)",
    "  ⎿  Wrote 146 lines to lib/db/stacks.ts",
    "",
    working,
    "──────────────────────────────────────────",
    "❯ ",
    "──────────────────────────────────────────",
    "  agent-os-build (feature/build) ✗ 8 19m ago …",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← for agents",
  ].join("\n");

describe("checkBusyIndicators", () => {
  it("sees Claude Code working above its input box, whatever the word", () => {
    expect(
      checkBusyIndicators(pane("✻ Composing… (4m 0s · ↓ 23.5k tokens)"))
    ).toBe(true);
    expect(checkBusyIndicators(pane("✢ Moseying… (12s · thinking)"))).toBe(
      true
    );
  });

  it("doesn't call a finished turn working", () => {
    expect(checkBusyIndicators(pane("⏺ Done. The PR is up."))).toBe(false);
  });
});

// Real panes, captured with their colours (tmux capture-pane -e -p).
const screen = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", "screens", name), "utf-8");

describe("findQuestion", () => {
  it("reads the question a Claude Code AskUserQuestion menu asks", () => {
    expect(findQuestion(screen("claude-question.ans"))).toBe(
      "Which database should we use for the cache?"
    );
  });

  it("reads a Codex menu's question, wrapped lines joined", () => {
    expect(findQuestion(screen("codex-menu.ans"))).toMatch(
      /^Trust this folder\? Codex can read.*Your trust decision will be saved\.$/
    );
  });

  it("finds no question at a prompt, while working, or in a permission prompt", () => {
    for (const name of [
      "claude-idle.ans",
      "claude-unsent.ans",
      "claude-working-typed.ans",
      "codex-unsent.ans",
      "claude-permission.ans",
    ])
      expect(findQuestion(screen(name)), name).toBeNull();
    expect(
      findQuestion(
        [
          " Bash command",
          "   rm -rf build",
          " Do you want to proceed?",
          " ❯ 1. Yes",
          "   2. Yes, and don't ask again for rm commands",
          "   3. No, and tell Claude what to do differently (esc)",
          "",
          " Esc to cancel · Tab to amend · Enter to confirm",
        ].join("\n")
      )
    ).toBeNull();
  });
});

describe("readInputBox", () => {
  it("reads text typed into Claude Code's box, wrapped lines joined", () => {
    expect(readInputBox(screen("claude-unsent.ans"))).toBe(
      "please fix the flaky test in the parser"
    );
    expect(readInputBox(screen("claude-unsent-wrapped.ans"))).toBe(
      "also add a TTL to every cache entry so stale rows expire on their own, and write a test that proves an expired row is never returned to a caller"
    );
  });

  it("doesn't take Claude Code's dim suggested prompt for typed text", () => {
    expect(readInputBox(screen("claude-idle.ans"))).toBe("");
    expect(readInputBox(screen("claude-empty.ans"))).toBe("");
  });

  it("reads Codex's box, and skips its dim placeholder", () => {
    expect(readInputBox(screen("codex-unsent.ans"))).toBe(
      "rename the cache module to store"
    );
    expect(readInputBox(screen("codex-unsent-wrapped.ans"))).toMatch(
      /^rename the cache module to store and also .* references cache anymore$/
    );
    expect(readInputBox(screen("codex-idle.ans"))).toBe("");
  });

  it("finds no box while a menu is up", () => {
    expect(readInputBox(screen("claude-question.ans"))).toBeNull();
    expect(readInputBox(screen("codex-menu.ans"))).toBeNull();
  });
});

describe("screenNeed", () => {
  // Each test starts with nothing typed.
  beforeEach(() => {
    statusDetector.screenNeed("fx", "", {}, 0);
  });
  const T0 = 1_000_000;
  const need = (name: string, at: number, opts = {}) =>
    statusDetector.screenNeed("fx", screen(name), opts, at);

  it("asks for an answer at once when a question menu is up", () => {
    expect(need("claude-question.ans", T0)).toEqual({
      need: "answer",
      detail: "Which database should we use for the cache?",
    });
    expect(need("claude-question.ans", T0, { question: false })).toBeNull();
  });

  it("calls typed text unsent only once it has sat unchanged", () => {
    expect(need("claude-unsent.ans", T0)).toBeNull();
    expect(need("claude-unsent.ans", T0 + UNSENT_MS - 1)).toBeNull();
    expect(statusDetector.unsentDue(T0 + UNSENT_MS)).toBe(true);
    expect(need("claude-unsent.ans", T0 + UNSENT_MS)).toEqual({
      need: "unsent",
      detail: "please fix the flaky test in the parser",
    });
    expect(statusDetector.unsentDue(T0 + UNSENT_MS)).toBe(false);
  });

  it("starts the wait over while the text is still changing", () => {
    need("claude-unsent.ans", T0);
    need("claude-unsent-wrapped.ans", T0 + 50_000);
    expect(need("claude-unsent-wrapped.ans", T0 + UNSENT_MS)).toBeNull();
    expect(need("claude-unsent-wrapped.ans", T0 + 50_000 + UNSENT_MS)).toEqual({
      need: "unsent",
      detail: expect.stringMatching(/^also add a TTL.*…$/),
    });
  });

  it("ignores text typed while the program works, and a suggestion", () => {
    for (const name of ["claude-working-typed.ans", "claude-idle.ans"]) {
      need(name, T0);
      expect(need(name, T0 + 2 * UNSENT_MS), name).toBeNull();
    }
  });

  it("forgets the text once it's sent", () => {
    need("codex-unsent.ans", T0);
    need("codex-idle.ans", T0 + 1000);
    expect(need("codex-unsent.ans", T0 + UNSENT_MS)).toBeNull();
  });

  it("leaves a real permission prompt to the waiting patterns", () => {
    const prompt = screen("claude-permission.ans");
    expect(checkWaitingPatterns(screenText(prompt))).toBe(true);
    // Its blank bottom rows hide the prompt from an untrimmed read.
    expect(checkWaitingPatterns(plainText(prompt))).toBe(false);
    expect(need("claude-permission.ans", T0)).toBeNull();
    expect(need("claude-permission.ans", T0 + 2 * UNSENT_MS)).toBeNull();
  });

  it("isn't due once the typed text is forgotten", () => {
    need("claude-unsent.ans", T0);
    statusDetector.clearUnsent("fx");
    expect(statusDetector.unsentDue(T0 + 2 * UNSENT_MS)).toBe(false);
  });
});
