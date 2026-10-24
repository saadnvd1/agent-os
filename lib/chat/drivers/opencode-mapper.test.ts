import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ChatItem, DriverEvent } from "../events";
import { OpenCodeMapper } from "./opencode-mapper";
import { openCodeRules, permissionCard } from "./opencode-rules";
import { openCodeModel, openCodeParts, openCodeSystem } from "./opencode";
import { RESULTS_BRIEF } from "./turn-outcome";

type Event = { type: string; properties: Record<string, unknown> };

// Event streams recorded from opencode 1.18.23 serve (paths set to /w).
const stream = (name: string) =>
  readFileSync(
    join(__dirname, "__fixtures__", `opencode-${name}.jsonl`),
    "utf8"
  )
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Event);

function replay(name: string) {
  const events = stream(name);
  const session = events.find((e) => e.type === "session.created")?.properties
    .sessionID as string;
  const out: DriverEvent[] = [];
  const mapper = new OpenCodeMapper(
    () => session,
    (e) => out.push(e)
  );
  mapper.prompted();
  for (const e of events) mapper.map(e);
  const items = new Map<string, ChatItem>();
  for (const e of out) if (e.type === "item") items.set(e.item.id, e.item);
  return { out, items: [...items.values()], events };
}

const texts = (items: ChatItem[], kind: string) =>
  items.filter((i) => i.kind === kind).map((i) => "text" in i && i.text);

describe("OpenCodeMapper", () => {
  it("shows the agent's reply, not the prompt echoed back", () => {
    const { items, out } = replay("text");
    expect(texts(items, "assistant")).toEqual(["ok"]);
    expect(texts(items, "reasoning")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "user")).toEqual([]);
    expect(out.filter((e) => e.type === "turn_start")).toHaveLength(1);
    expect(out.at(-1)).toEqual({ type: "state", state: "idle" });
  });

  it("maps a tool run and sums usage over the turn's steps", () => {
    const { items, out } = replay("tool");
    const tools = items.filter((i) => i.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "Bash",
      title: "ls",
      status: "done",
      output: "a.txt\n",
    });
    expect(texts(items, "assistant")).toEqual(["a.txt"]);
    expect(out.find((e) => e.type === "usage")).toEqual({
      type: "usage",
      totals: {
        costUsd: 0,
        inputTokens: 1284 + 1455,
        outputTokens: 115 + 37 + 4 + 29,
        cacheReadTokens: 13056 * 2,
        cacheWriteTokens: 0,
      },
    });
  });

  it("ignores an idle left over from before the prompt", () => {
    const out: DriverEvent[] = [];
    const mapper = new OpenCodeMapper(
      () => "s",
      (e) => out.push(e)
    );
    mapper.prompted();
    mapper.map({ type: "session.idle", properties: { sessionID: "s" } });
    expect(mapper.items.inTurn).toBe(true);
    mapper.map({
      type: "session.status",
      properties: { sessionID: "s", status: { type: "busy" } },
    });
    mapper.map({ type: "session.idle", properties: { sessionID: "s" } });
    expect(mapper.items.inTurn).toBe(false);
  });

  it("calls a stopped turn interrupted, and keeps its late updates there", () => {
    const out: DriverEvent[] = [];
    const mapper = new OpenCodeMapper(
      () => "s",
      (e) => out.push(e)
    );
    const aborted = {
      type: "message.updated",
      properties: {
        sessionID: "s",
        info: {
          id: "m1",
          role: "assistant",
          error: { name: "MessageAbortedError", data: { message: "Aborted" } },
        },
      },
    };
    const busy = {
      type: "session.status",
      properties: { sessionID: "s", status: { type: "busy" } },
    };
    const idle = { type: "session.idle", properties: { sessionID: "s" } };
    mapper.prompted();
    for (const e of [busy, aborted, idle]) mapper.map(e);
    mapper.prompted();
    for (const e of [busy, aborted, idle]) mapper.map(e);
    const ends = out.filter(
      (e) => e.type === "item" && e.item.kind === "turn_end"
    ) as { item: { interrupted?: boolean } }[];
    expect(ends.map((e) => e.item.interrupted)).toEqual([true, false]);
  });
});

describe("OpenCode permissions", () => {
  it("shows a recorded bash permission as a command card", () => {
    const asked = stream("tool").find((e) => e.type === "permission.asked")!;
    expect(permissionCard(asked.properties)).toMatchObject({
      toolName: "Bash",
      title: "ls",
    });
  });

  it("shows an edit's diff", () => {
    const card = permissionCard({
      permission: "edit",
      patterns: ["a.ts"],
      metadata: {
        filepath: "/w/a.ts",
        diff: "Index: /w/a.ts\n===\n--- /w/a.ts\n+++ /w/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
      },
    });
    expect(card.diff).toEqual({ path: "/w/a.ts", before: "a\n", after: "b\n" });
  });

  // OpenCode's own matching: the last rule whose permission and pattern
  // match decides.
  const decide = (
    access: "ask" | "edits" | "full",
    permission: string,
    target = "*"
  ) => {
    const glob = (p: string) =>
      new RegExp(
        `^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`
      );
    return openCodeRules(access)
      .filter(
        (r) =>
          (r.permission === "*" || r.permission === permission) &&
          glob(r.pattern).test(target)
      )
      .at(-1)?.action;
  };

  it("asks before reading .env files, whatever else reads freely", () => {
    for (const access of ["ask", "edits"] as const) {
      expect(decide(access, "read", ".env")).toBe("ask");
      expect(decide(access, "read", ".env.local")).toBe("ask");
      expect(decide(access, "read", ".env.example")).toBe("allow");
      expect(decide(access, "read", "a.ts")).toBe("allow");
      expect(decide(access, "bash", "ls")).toBe("ask");
      expect(decide(access, "external_directory")).toBe("ask");
    }
    expect(decide("full", "bash", "ls")).toBe("allow");
    expect(decide("full", "external_directory")).toBe("allow");
  });

  it("lets the last rule win: edits allowed only in 'edits'", () => {
    const last = (access: "ask" | "edits") =>
      openCodeRules(access)
        .filter((r) => r.permission === "edit")
        .at(-1)?.action;
    expect(last("ask")).toBe("ask");
    expect(last("edits")).toBe("allow");
    expect(openCodeRules("full")[0]).toEqual({
      permission: "*",
      pattern: "*",
      action: "allow",
    });
  });
});

describe("opencode arguments", () => {
  it("splits provider and model, and leaves the default to OpenCode", () => {
    expect(openCodeModel("opencode/nemotron-3.5-lightning-free")).toEqual({
      providerID: "opencode",
      modelID: "nemotron-3.5-lightning-free",
    });
    expect(openCodeModel("default")).toBeUndefined();
    expect(
      openCodeParts("hi", [{ mediaType: "image/png", data: "QQ==" }])
    ).toEqual([
      { type: "text", text: "hi" },
      {
        type: "file",
        mime: "image/png",
        filename: "image-1.png",
        url: "data:image/png;base64,QQ==",
      },
    ]);
  });
});

describe("OpenCodeMapper turns that end early", () => {
  it("flags a message that finished for length, and logs it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out: DriverEvent[] = [];
    const mapper = new OpenCodeMapper(
      () => "s1",
      (e) => out.push(e)
    );
    mapper.prompted();
    const e = (type: string, properties: Record<string, unknown>) =>
      mapper.map({ type, properties: { sessionID: "s1", ...properties } });
    e("session.status", { status: { type: "busy" } });
    e("message.updated", {
      info: {
        id: "m1",
        role: "assistant",
        finish: "length",
        providerID: "stub",
        modelID: "qwen",
      },
    });
    e("message.part.updated", {
      part: { id: "p1", messageID: "m1", type: "text", text: "The plan is to" },
    });
    e("session.status", { status: { type: "idle" } });
    const end = out.find(
      (x) => x.type === "item" && x.item.kind === "turn_end"
    );
    expect(end).toMatchObject({
      item: { finishReason: "length", ended: { reason: "length" } },
    });
    expect(JSON.parse(warn.mock.calls[0][1] as string)).toMatchObject({
      driver: "opencode",
      provider: "stub",
      reason: "length",
    });
    warn.mockRestore();
  });

  it("leaves the recorded turns without a notice", () => {
    for (const name of ["text", "tool"])
      for (const i of replay(name).items)
        if (i.kind === "turn_end") expect(i.ended).toBeUndefined();
  });
});

describe("OpenCodeMapper summary nudge", () => {
  const S = "s1";
  const ev = (type: string, properties: Record<string, unknown>) => ({
    type,
    properties: { sessionID: S, ...properties },
  });
  const step = (id: string, text: string, tool = false, finish = "stop") => [
    ev("message.updated", { info: { id, role: "assistant", finish } }),
    ...(tool
      ? [
          ev("message.part.updated", {
            part: {
              id: `${id}-t`,
              messageID: id,
              type: "tool",
              tool: "bash",
              state: { status: "completed", input: {}, output: "ok" },
            },
          }),
        ]
      : []),
    ev("message.part.updated", {
      part: { id: `${id}-x`, messageID: id, type: "text", text },
    }),
  ];
  const busy = ev("session.status", { status: { type: "busy" } });
  const idle = ev("session.idle", {});
  function run(...batches: Record<string, unknown>[][]) {
    const out: DriverEvent[] = [];
    const mapper = new OpenCodeMapper(
      () => S,
      (e) => out.push(e)
    );
    mapper.prompted();
    const nudges: boolean[] = [];
    for (const batch of batches) {
      for (const e of batch) mapper.map(e as never);
      nudges.push(mapper.takeNudge());
    }
    return { out, mapper, nudges };
  }
  const ends = (out: DriverEvent[]) =>
    out.filter((e) => e.type === "state" && e.state === "idle").length;

  it("keeps the turn open and asks once after tools and a lead-in", () => {
    const { out, mapper, nudges } = run(
      [
        busy,
        ...step("m0", "", true, "tool-calls"),
        ...step("m1", "Here's what I found:"),
        idle,
      ],
      [busy, ...step("m2", ""), idle]
    );
    expect(nudges).toEqual([true, false]);
    expect(ends(out)).toBe(1);
    expect(mapper.items.inTurn).toBe(false);
  });

  it("ends normally when the reply has the results", () => {
    const { out, nudges } = run([
      busy,
      ...step("m0", "", true, "tool-calls"),
      ...step("m1", "All 3 checks passed."),
      idle,
    ]);
    expect(nudges).toEqual([false]);
    expect(ends(out)).toBe(1);
  });

  it("doesn't nudge without tools, after an error, a length cut-off or an interrupt", () => {
    expect(run([busy, ...step("m1", "Let me look:"), idle]).nudges).toEqual([
      false,
    ]);
    expect(
      run([
        busy,
        ...step("m0", "", true, "tool-calls"),
        ...step("m1", "Found:", false, "length"),
        idle,
      ]).nudges
    ).toEqual([false]);
    expect(
      run([
        busy,
        ...step("m0", "", true, "tool-calls"),
        ...step("m1", "Found:"),
        ev("session.error", { error: { name: "X", data: { message: "bad" } } }),
        idle,
      ]).nudges
    ).toEqual([false]);
    expect(
      run([
        busy,
        ...step("m0", "", true, "tool-calls"),
        ...step("m1", "Found:"),
        ev("session.error", { error: { name: "MessageAbortedError" } }),
        idle,
      ]).nudges
    ).toEqual([false]);
  });

  it("puts the results brief in the prompt's system text", () => {
    expect(openCodeSystem("brief")).toBe(`brief\n\n${RESULTS_BRIEF}`);
    expect(openCodeSystem()).toBe(RESULTS_BRIEF);
  });
});

describe("OpenCodeMapper live tool output", () => {
  it("streams a running tool's output, tails it, and the end replaces it", () => {
    vi.useFakeTimers();
    const out: DriverEvent[] = [];
    const mapper = new OpenCodeMapper(
      () => "s1",
      (e) => out.push(e)
    );
    mapper.prompted();
    const e = (type: string, properties: Record<string, unknown>) =>
      mapper.map({ type, properties: { sessionID: "s1", ...properties } });
    const tool = (state: Record<string, unknown>) =>
      e("message.part.updated", {
        part: {
          id: "p1",
          messageID: "m1",
          type: "tool",
          tool: "bash",
          state: { input: { command: "make" }, ...state },
        },
      });
    const last = () =>
      out
        .flatMap((x) =>
          x.type === "item" && x.item.kind === "tool" ? [x.item] : []
        )
        .at(-1)!;
    e("session.status", { status: { type: "busy" } });
    e("message.updated", { info: { id: "m1", role: "assistant" } });
    tool({ status: "running", metadata: { output: "building" } });
    expect(last()).toMatchObject({ status: "running", output: "building" });
    vi.advanceTimersByTime(300);
    tool({
      status: "running",
      metadata: {
        output: Array.from({ length: 900 }, (_, i) => `row ${i}`).join("\n"),
      },
    });
    const lines = last().output!.split("\n");
    expect(lines.length).toBeLessThanOrEqual(201);
    expect(lines.at(-1)).toBe("row 899");
    tool({ status: "completed", output: "built" });
    expect(last()).toMatchObject({ status: "done", output: "built" });
    vi.useRealTimers();
  });
});

describe("OpenCodeMapper retries", () => {
  const HEADERS = "Provider response headers timed out after 300000ms";
  const SID = "ses_1";

  function drive() {
    const out: DriverEvent[] = [];
    const retries: { delayMs: number; compactFirst: boolean }[] = [];
    const mapper = new OpenCodeMapper(
      () => SID,
      (e) => out.push(e),
      (d) => retries.push(d)
    );
    const send = (type: string, properties: Record<string, unknown>) =>
      mapper.map({ type, properties: { sessionID: SID, ...properties } });
    let n = 0;
    const fail = (message = HEADERS) => {
      send("session.status", { status: { type: "busy" } });
      send("message.updated", {
        info: { id: `m${++n}`, role: "assistant", providerID: "local" },
      });
      send("session.error", { error: { name: "APIError", data: { message } } });
      send("session.status", { status: { type: "idle" } });
    };
    const ends = () =>
      out.flatMap((e) =>
        e.type === "item" && e.item.kind === "turn_end" ? [e.item] : []
      );
    const notes = () =>
      out.flatMap((e) =>
        e.type === "item" && e.item.kind === "note" ? [e.item.text] : []
      );
    return { mapper, retries, send, fail, ends, notes };
  }

  function ranTool(d: ReturnType<typeof drive>) {
    d.mapper.items.tool("t1", {
      name: "Edit",
      title: "Edit src/applier/sources.ts",
      input: { file_path: "src/applier/sources.ts" },
    });
    d.mapper.items.toolDone("t1", "error", "oldString not found");
  }

  it("keeps the turn open and asks for a retry", () => {
    const d = drive();
    d.mapper.prompted();
    d.fail();
    expect(d.ends()).toHaveLength(0);
    expect(d.mapper.items.inTurn).toBe(true);
    expect(d.retries).toHaveLength(1);
    expect(d.retries[0].delayMs).toBeGreaterThan(1000);
    expect(d.notes()[0]).toContain("Trying again");
  });

  it("gives up after three retries with a report of what finished", () => {
    const d = drive();
    d.mapper.prompted();
    ranTool(d);
    for (let i = 0; i < 3; i++) {
      d.fail();
      d.mapper.prompted(true);
    }
    expect(d.ends()).toHaveLength(0);
    d.fail();
    const [end] = d.ends();
    expect(d.retries).toHaveLength(3);
    expect(end.ended?.notice).toContain("3 retries didn't get through");
    expect(end.ended?.notice).toContain("src/applier/sources.ts (1 failed)");
    expect(d.mapper.items.inTurn).toBe(false);
  });

  it("does not retry on top of OpenCode's own retries", () => {
    const d = drive();
    d.mapper.prompted();
    d.send("session.status", {
      status: { type: "retry", attempt: 1, message: HEADERS, next: 1 },
    });
    d.fail();
    expect(d.retries).toHaveLength(0);
    expect(d.ends()[0].ended?.notice).toContain("even after the agent retried");
  });

  it("ends an error that isn't transient straight away", () => {
    const d = drive();
    d.mapper.prompted();
    d.fail("401 Unauthorized");
    expect(d.retries).toHaveLength(0);
    expect(d.ends()[0].ended?.notice).toBe(
      "The model's server returned an error, shown above."
    );
  });

  it("starts the count over for a new message", () => {
    const d = drive();
    d.mapper.prompted();
    for (let i = 0; i < 3; i++) {
      d.fail();
      d.mapper.prompted(true);
    }
    d.fail();
    d.mapper.prompted();
    d.fail();
    expect(d.retries).toHaveLength(4);
  });

  it("ignores the idle of a compaction between retries", () => {
    const d = drive();
    d.mapper.prompted();
    d.fail();
    d.mapper.holdIdle(true);
    d.send("session.status", { status: { type: "busy" } });
    d.send("session.status", { status: { type: "idle" } });
    d.mapper.holdIdle(false);
    expect(d.ends()).toHaveLength(0);
    expect(d.mapper.items.inTurn).toBe(true);
  });

  it("ends as interrupted when stopped while waiting", () => {
    const d = drive();
    d.mapper.prompted();
    d.fail();
    d.mapper.stopRetrying();
    expect(d.ends()[0]).toMatchObject({ interrupted: true });
  });
});

describe("OpenCodeMapper request reports", () => {
  const mapper = () => {
    const out: DriverEvent[] = [];
    const m = new OpenCodeMapper(
      () => "s1",
      (e) => out.push(e)
    );
    m.prompted();
    return { m, out };
  };

  it("reports a retry and still starts the turn", () => {
    const { m, out } = mapper();
    m.map({
      type: "session.status",
      properties: {
        sessionID: "s1",
        status: { type: "retry", attempt: 3, message: "rate limited" },
      },
    });
    expect(out).toContainEqual({
      type: "model_retry",
      attempt: 3,
      message: "rate limited",
    });
  });

  it("reports the measured prompt of a completed response", () => {
    const { m, out } = mapper();
    m.map({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "a1",
          role: "assistant",
          time: { completed: 1 },
          tokens: { input: 200, output: 5, cache: { read: 800, write: 0 } },
        },
      },
    });
    expect(out).toContainEqual({ type: "prompt_tokens", tokens: 1000 });
  });
});
