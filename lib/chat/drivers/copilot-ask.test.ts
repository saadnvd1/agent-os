import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatItem, DriverEvent } from "../events";
import {
  askUserQuestion,
  askUserResult,
  CopilotAskServer,
  isAskUserCall,
} from "./copilot-ask";
import { CopilotApprovals } from "./copilot-approvals";

const open: { close(): unknown }[] = [];
afterEach(async () => {
  for (const c of open.splice(0)) await c.close();
});

async function setup(access: "ask" | "full" = "ask") {
  const events: DriverEvent[] = [];
  const approvals = new CopilotApprovals((e) => events.push(e), access);
  const server = new CopilotAskServer(approvals.pending);
  const entry = (await server.start()) as { url: string };
  open.push(server);
  const connect = async (url = entry.url) => {
    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    open.push(client);
    return client;
  };
  const cards = () =>
    events.flatMap((e) =>
      e.type === "item" && e.item.kind === "approval" ? [e.item] : []
    ) as Extract<ChatItem, { kind: "approval" }>[];
  const pendingId = async () => {
    for (let i = 0; i < 100 && !approvals.pending.has("approval-ask-1"); i++)
      await new Promise((r) => setTimeout(r, 5));
    return "approval-ask-1";
  };
  return { events, approvals, server, entry, connect, cards, pendingId };
}

const text = (r: unknown) =>
  ((r as { content: { text: string }[] }).content[0] ?? { text: "" }).text;

describe("CopilotAskServer", () => {
  it("offers ask_user with a required question", async () => {
    const { connect } = await setup();
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual(["ask_user"]);
    expect(tools[0].inputSchema.required).toEqual(["question"]);
    expect(Object.keys(tools[0].inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["options", "multiSelect", "allowFreeText"])
    );
  });

  it("blocks on a question card and returns the choice", async () => {
    const t = await setup();
    const call = (await t.connect()).callTool({
      name: "ask_user",
      arguments: {
        question: "Which db?",
        options: [{ label: "Postgres" }, { label: "SQLite" }],
      },
    });
    const id = await t.pendingId();
    expect(t.cards()[0]).toMatchObject({
      toolName: "AskUserQuestion",
      status: "pending",
      questions: [{ question: "Which db?", multiSelect: false }],
    });
    expect(t.events).toContainEqual({ type: "state", state: "waiting" });
    t.approvals.pending.respond(id, {
      decision: "answer",
      answers: { "Which db?": "SQLite" },
    });
    expect(JSON.parse(text(await call))).toEqual({ answer: "SQLite" });
    expect(t.events.at(-1)).toEqual({ type: "state", state: "running" });
  });

  it("returns several answers for a multi-select, and free text", async () => {
    const t = await setup();
    const client = await t.connect();
    const multi = client.callTool({
      name: "ask_user",
      arguments: {
        question: "Which?",
        multiSelect: true,
        options: [{ label: "A" }, { label: "B" }],
      },
    });
    t.approvals.pending.respond(await t.pendingId(), {
      decision: "answer",
      answers: { "Which?": "A, B" },
    });
    expect(JSON.parse(text(await multi))).toEqual({ answers: ["A", "B"] });

    const free = client.callTool({
      name: "ask_user",
      arguments: { question: "Name?" },
    });
    for (let i = 0; i < 100 && !t.approvals.pending.has("approval-ask-2"); i++)
      await new Promise((r) => setTimeout(r, 5));
    t.approvals.pending.respond("approval-ask-2", {
      decision: "answer",
      answers: { "Name?": "Ada" },
    });
    expect(JSON.parse(text(await free))).toEqual({ answer: "Ada" });
  });

  it("still waits for the user under full access", async () => {
    const t = await setup("full");
    let done = false;
    const call = (await t.connect())
      .callTool({ name: "ask_user", arguments: { question: "Sure?" } })
      .then((r) => ((done = true), r));
    const id = await t.pendingId();
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false);
    t.approvals.pending.respond(id, { decision: "deny" });
    expect(text(await call)).toMatch(/skipped/);
  });

  it("cancels a waiting question when the turn stops", async () => {
    const t = await setup();
    const call = (await t.connect()).callTool({
      name: "ask_user",
      arguments: { question: "Sure?" },
    });
    await t.pendingId();
    t.approvals.pending.expireAll();
    const r = await call;
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/cancelled/);
    expect(t.cards().at(-1)?.status).toBe("expired");
  });

  it("cancels on close and stops listening", async () => {
    const t = await setup();
    const call = (await t.connect()).callTool({
      name: "ask_user",
      arguments: { question: "Sure?" },
    });
    await t.pendingId();
    t.server.close();
    t.server.close();
    expect(t.cards().at(-1)?.status).toBe("expired");
    await call.catch(() => {});
    await expect(fetch(t.entry.url, { method: "POST" })).rejects.toThrow();
  });

  it("keeps two conversations apart", async () => {
    const a = await setup();
    const b = await setup();
    const wrong = b.entry.url.replace(/\/mcp\/.*/, "/mcp/") + "0".repeat(64);
    for (const url of [wrong, a.entry.url.replace(/\/mcp\/.*/, "/mcp")]) {
      const r = await fetch(url, { method: "POST", body: "{}" });
      expect(r.status).toBe(404);
    }
    const call = (await a.connect()).callTool({
      name: "ask_user",
      arguments: { question: "Q?" },
    });
    const id = await a.pendingId();
    b.approvals.pending.respond(id, { decision: "deny" });
    expect(a.approvals.pending.has(id)).toBe(true);
    expect(b.cards()).toEqual([]);
    a.approvals.pending.respond(id, { decision: "deny" });
    await call;
  });

  it("refuses a browser origin", async () => {
    const t = await setup();
    const r = await fetch(t.entry.url, {
      method: "POST",
      headers: { origin: "http://evil.example" },
      body: "{}",
    });
    expect(r.status).toBe(403);
  });
});

describe("question mapping", () => {
  it("cleans options and only multi-selects with options", () => {
    expect(
      askUserQuestion({
        question: " Pick ",
        multiSelect: true,
        options: [
          { label: "A", description: " a " },
          { label: "A" },
          { label: "  " },
        ],
      })
    ).toEqual({
      question: "Pick",
      header: "",
      multiSelect: true,
      options: [{ label: "A", description: "a" }],
    });
    expect(askUserQuestion({ question: "Q", multiSelect: true })).toMatchObject(
      { multiSelect: false, options: [] }
    );
  });

  it("maps outcomes to results", () => {
    const q = askUserQuestion({ question: "Q" });
    expect(
      text(askUserResult(q, { decision: "answer", answers: { Q: "x" } }))
    ).toBe('{"answer":"x"}');
    expect(askUserResult(q, { decision: "expired" }).isError).toBe(true);
    expect(askUserResult(q, { decision: "deny" }).isError).toBeUndefined();
  });

  it("recognises its own tool call", () => {
    expect(isAskUserCall({ title: "agentos-ask_user" })).toBe(true);
    expect(isAskUserCall({ title: "ls", rawInput: { question: "x" } })).toBe(
      false
    );
    expect(
      isAskUserCall({ title: "agentos", rawInput: { question: "x" } })
    ).toBe(true);
  });
});
