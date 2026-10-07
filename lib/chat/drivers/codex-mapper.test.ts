import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatItem, DriverEvent } from "../events";
import { CodexApprovals } from "./codex-approvals";
import { CodexMapper } from "./codex-mapper";
import { unifiedToDiff } from "../diff";
import { CODEX_MODES, codexInput, threadParams } from "./codex-args";

type Line = { method: string; id?: number; params: Record<string, unknown> };

// Recorded from codex app-server 0.156 (ids shortened, paths set to /w).
const lines = readFileSync(
  join(__dirname, "__fixtures__", "codex-turns.jsonl"),
  "utf8"
)
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Line);

async function replay() {
  const events: DriverEvent[] = [];
  const emit = (e: DriverEvent) => events.push(e);
  const mapper = new CodexMapper(emit);
  const approvals = new CodexApprovals(emit);
  const replies: unknown[] = [];
  for (const l of lines) {
    if (l.id !== undefined) {
      const reply = approvals.handle(l.method, l.params);
      const card = events.findLast(
        (e) => e.type === "item" && e.item.kind === "approval"
      ) as { item: ChatItem };
      approvals.pending.respond(card.item.id, {
        decision: l.id === 0 ? "allow" : "always",
      });
      replies.push(await reply);
      continue;
    }
    if (l.method === "item/started") approvals.sawItem(l.params.item as never);
    mapper.map(l.method, l.params);
  }
  const items = new Map<string, ChatItem>();
  for (const e of events) if (e.type === "item") items.set(e.item.id, e.item);
  return { events, items: [...items.values()], replies };
}

describe("CodexMapper", () => {
  it("turns a recorded turn into chat items", async () => {
    const { items, events } = await replay();
    const of = (kind: string) => items.filter((i) => i.kind === kind);
    expect(of("assistant").map((i) => "text" in i && i.text)).toEqual([
      "fixture simple ok",
    ]);
    expect(of("reasoning").map((i) => "text" in i && i.text)).toEqual([
      "**Planning**",
    ]);
    const tools = of("tool") as Extract<ChatItem, { kind: "tool" }>[];
    expect(tools.map((t) => [t.name, t.status])).toEqual([
      ["Bash", "done"],
      ["Edit", "done"],
      ["Bash", "stopped"],
    ]);
    expect(tools[0].input).toMatchObject({
      command: "printf '%s' 'ok' > probe.txt",
    });
    expect(tools[1].diff).toEqual({
      path: "/w/a.ts",
      before: "const a = 1;\n",
      after: "const a = 2;\n",
    });
    expect(of("todos")[0]).toMatchObject({
      todos: [
        { text: "Write probe", status: "completed" },
        { text: "Edit a.ts", status: "in_progress" },
      ],
    });
    const ends = of("turn_end") as Extract<ChatItem, { kind: "turn_end" }>[];
    expect(ends.map((e) => !!e.interrupted)).toEqual([false, true]);
    const turns = events.filter((e) => e.type === "turn_start").length;
    const idles = events.filter(
      (e) => e.type === "state" && e.state === "idle"
    ).length;
    expect([turns, idles]).toEqual([2, 2]);
  });

  it("sums each response's usage, with cached input apart", async () => {
    const { events } = await replay();
    const usage = events.filter((e) => e.type === "usage");
    expect(usage[0]).toEqual({
      type: "usage",
      totals: {
        costUsd: 0,
        inputTokens: 22438 - 22272 + 22783 - 22272,
        outputTokens: 288 + 27,
        cacheReadTokens: 22272 * 2,
        cacheWriteTokens: 0,
      },
    });
  });

  it("answers approvals in Codex's words", async () => {
    const { replies, items } = await replay();
    expect(replies).toEqual([
      { decision: "accept" },
      { decision: "acceptForSession" },
    ]);
    const cards = items.filter((i) => i.kind === "approval");
    expect(cards.map((c) => c.kind === "approval" && c.status)).toEqual([
      "allowed",
      "allowed",
    ]);
  });

  it("doesn't count a resumed thread's last use as a turn", () => {
    const events: DriverEvent[] = [];
    const mapper = new CodexMapper((e) => events.push(e));
    mapper.map("thread/tokenUsage/updated", lines[16].params);
    mapper.map("turn/started", { turn: { id: "U9" } });
    mapper.map("turn/completed", { turn: { id: "U9", status: "completed" } });
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ totals: { inputTokens: 0 } });
  });
});

describe("codex arguments", () => {
  it("maps access to approval policy and sandbox", () => {
    expect(CODEX_MODES.ask.approvalPolicy).toBe("untrusted");
    expect(CODEX_MODES.full.sandboxPolicy).toEqual({
      type: "dangerFullAccess",
    });
    const p = threadParams(
      { cwd: "/w", model: "default", access: "edits", env: {} },
      "edits"
    );
    expect(p).toMatchObject({
      cwd: "/w",
      model: undefined,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
  });

  it("sends images as data URLs ahead of the text", () => {
    expect(
      codexInput("hi", [{ mediaType: "image/png", data: "QQ==" }])
    ).toEqual([
      { type: "image", url: "data:image/png;base64,QQ==" },
      { type: "text", text: "hi" },
    ]);
  });

  it("reads both sides of a unified diff", () => {
    expect(unifiedToDiff("f", "@@ -1,2 +1,2 @@\n a\n-b\n+c")).toEqual({
      path: "f",
      before: "a\nb",
      after: "a\nc",
    });
  });
});
