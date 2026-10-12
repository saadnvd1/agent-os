import { describe, expect, it } from "vitest";
import {
  buildLogMarkdown,
  codeSpan,
  formatDuration,
  type LogData,
} from "./build";

// The document with its fenced blocks taken out: what a renderer treats as
// structure.
function outsideFences(md: string): string {
  const out: string[] = [];
  let open: string | null = null;
  for (const line of md.split("\n")) {
    const m = /^\s*(`{3,})/.exec(line);
    if (open) {
      if (m && m[1].length >= open.length && line.trim() === m[1]) open = null;
    } else if (m) open = m[1];
    else out.push(line);
  }
  return out.join("\n");
}

const full = (): LogData => ({
  id: "11111111-2222-3333-4444-555555555555",
  name: "Add login throttle",
  workspace: "Work",
  project: "api",
  branch: "feature/login-throttle",
  prNumber: 42,
  prUrl: "https://github.com/acme/api/pull/42",
  mergeCommit: "abcdef1234567890",
  startedAt: "2026-10-12 09:00:00",
  mergedAt: "2026-10-12 10:15:00",
  prompt: "Throttle logins.\nKeep it small.",
  scopeChanges: [
    { at: "2026-10-12 09:30:00", text: "Also cover the reset endpoint." },
    { at: "2026-10-12 09:40:00", text: "Skip the admin API." },
  ],
  plan: "1. Add limiter\n2. Test it",
  planKept: true,
  timeline: [
    { at: null, text: "PR #42 opened" },
    {
      at: "2026-10-12 09:50:00",
      text: "CI failed",
      sha: "1111111aaaa",
      quote: "failing check: unit",
    },
    {
      at: "2026-10-12 09:55:00",
      text: "Review blocked the merge",
      sha: "1111111aaaa",
      detail: "Blocking: the limiter is per-process.",
    },
    {
      at: "2026-10-12 10:00:00",
      text: "Escalated to Saad (decision)",
      quote: "Use redis?",
    },
    {
      at: "2026-10-12 10:05:00",
      text: "Saad answered",
      detail: "No, keep memory.",
    },
    { at: "2026-10-12 10:15:00", text: "PR #42 merged" },
  ],
  usage: [
    {
      role: "plan",
      model: "anthropic/claude-opus-5-5",
      turns: 3,
      inputTokens: 1000,
      outputTokens: 2000,
      cacheReadTokens: 30000,
      cacheWriteTokens: 4000,
      costUsd: 0.5,
      unpriced: false,
    },
    {
      role: "implement",
      model: "other/model-x",
      turns: 10,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      unpriced: true,
    },
  ],
  outcome: "Done. Verified with `npm test`.",
  sessionPath: "/?session=11111111-2222-3333-4444-555555555555",
});

describe("buildLogMarkdown", () => {
  it("writes every section in a fixed order", () => {
    const md = buildLogMarkdown(full());
    const heads = outsideFences(md).match(/^#{1,3} .*$/gm);
    expect(heads).toEqual([
      "# Session log: Add login throttle",
      "## Brief",
      "### Original prompt",
      "### Scope changes",
      "## Plan",
      "## Timeline",
      "## Usage",
      "## Outcome",
      "## Links",
    ]);
    expect(md).toContain(
      "**Pull request:** #42 <https://github.com/acme/api/pull/42>"
    );
    expect(md).toContain("**Merge commit:** `abcdef1234567890`");
    expect(md).toContain("**Duration:** 1h 15m");
    expect(md).toContain("Throttle logins.\nKeep it small.");
    expect(md.indexOf("Also cover the reset")).toBeLessThan(
      md.indexOf("Skip the admin API")
    );
    expect(md).toContain("1. Add limiter");
    expect(md).toContain("CI failed on `1111111`: `failing check: unit`");
    expect(md).toContain("Blocking: the limiter is per-process.");
    expect(md).toContain("| plan | anthropic/claude-opus-5-5 | 3 |");
    expect(md).toContain(
      "| implement | other/model-x | 10 | 10 | 20 | 0 | 0 | ≥ $0.0000 |"
    );
    expect(md).toContain("| **Total** | | 13 |");
    expect(md).toContain("Done. Verified with `npm test`.");
    expect(md).toContain("- Session in AgentOS: `/?session=");
  });

  it("copies the outcome verbatim", () => {
    const outcome =
      "Line one.\n\n- did a\n- did b\n\nVerified: `npm test` passed.";
    expect(buildLogMarkdown({ ...full(), outcome })).toContain(outcome);
  });

  it("says what is missing instead of leaving a gap", () => {
    const md = buildLogMarkdown({
      ...full(),
      scopeChanges: [],
      plan: null,
      planKept: true,
      timeline: [],
      usage: [],
      outcome: null,
      prNumber: null,
      prUrl: null,
      mergeCommit: null,
      mergedAt: null,
    });
    expect(md).not.toContain("### Scope changes");
    expect(md).toContain("This task wrote no plan.");
    expect(md).toContain("Nothing was recorded.");
    expect(md).toContain("No model usage was recorded");
    expect(md).toContain("left no final message");
    expect(md).toContain("**Pull request:** none recorded");
    expect(md).toContain("**Duration:** unknown");
    expect(md).not.toContain("- Pull request:");
  });

  it("marks a plan that was gone before the log was written", () => {
    const md = buildLogMarkdown({ ...full(), plan: null, planKept: false });
    expect(md).toContain("Plan not kept");
  });

  it("trims a long verdict", () => {
    const md = buildLogMarkdown({
      ...full(),
      timeline: [
        {
          at: null,
          text: "Review blocked the merge",
          detail: "x".repeat(5000),
        },
      ],
    });
    expect(md).toContain("… (trimmed)");
    expect(md.length).toBeLessThan(5000);
  });

  it("keeps untrusted text from changing the document", () => {
    const evil =
      "```\n# Fake heading\n[click](javascript:alert(1))\n```\n## Plan";
    const md = buildLogMarkdown({
      ...full(),
      name: "x\n# Injected\n<script>alert(1)</script>",
      branch: "a`b\n## Branch",
      prompt: evil,
      scopeChanges: [{ at: "2026-10-12 09:30:00", text: evil }],
      plan: evil,
      outcome: evil,
      timeline: [
        {
          at: null,
          text: "CI failed",
          quote: "`**bold**`\n# h",
          detail: evil,
        },
      ],
      usage: [{ ...full().usage[0], role: "| a |\n# h", model: "m|<b>" }],
    });
    // Every heading is one of ours.
    expect(outsideFences(md).match(/^#{1,6} .*$/gm)).toEqual([
      expect.stringMatching(/^# Session log: x \\# Injected \\<script\\>/),
      "## Brief",
      "### Original prompt",
      "### Scope changes",
      "## Plan",
      "## Timeline",
      "## Usage",
      "## Outcome",
      "## Links",
    ]);
    // The hostile fence is wrapped in a longer one, so it stays text.
    expect(md).toContain("````text\n" + evil + "\n````");
    const structure = outsideFences(md);
    expect(structure).not.toMatch(/^<script/m);
    expect(structure).not.toContain("[click](javascript");
    // Where it appears outside a fence it is in a code span or escaped.
    expect(structure.replace(/`[^`\n]*`/g, "")).not.toContain("<script>");
  });

  it("does not link a PR address that is not a plain web address", () => {
    const md = buildLogMarkdown({
      ...full(),
      prUrl: "javascript:alert(1)",
    });
    expect(md).not.toContain("<javascript");
    expect(md).toContain("`javascript:alert(1)`");
  });

  it("redacts credentials in what it copies", () => {
    const key = "sk" + "-" + "a".repeat(32);
    const md = buildLogMarkdown({ ...full(), outcome: `key ${key} here` });
    expect(md).not.toContain(key);
    expect(md).toContain("[redacted]");
  });
});

describe("codeSpan / formatDuration", () => {
  it("spans text containing backticks", () => {
    expect(codeSpan("a`b")).toBe("``a`b``");
    expect(codeSpan("`a`")).toBe("`` `a` ``");
    expect(codeSpan("  \n ")).toBe("`(empty)`");
  });
  it("formats durations", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(75 * 60_000)).toBe("1h 15m");
    expect(formatDuration(26 * 3_600_000)).toBe("1d 2h 0m");
  });
});
