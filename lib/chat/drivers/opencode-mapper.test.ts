import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatItem, DriverEvent } from "../events";
import { OpenCodeMapper } from "./opencode-mapper";
import { openCodeRules, permissionCard } from "./opencode-rules";
import { openCodeModel, openCodeParts } from "./opencode";

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
