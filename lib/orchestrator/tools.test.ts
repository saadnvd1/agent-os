import { describe, expect, it, vi } from "vitest";
import type { LhCard } from "@/lib/lumifyhub/types";
import { seedWorkspace } from "./testing";

// The task's terminal is live and waiting with a BLOCKED: line; its PR is up.
const PANE = "building...\n⏺ BLOCKED: need the staging API key\n❯ ";
vi.mock("@/lib/status-detector", () => ({
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: (name: string) => name.startsWith("claude-"),
    getStatus: async () => "waiting",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => PANE,
  },
}));
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async () => ({ stdout: `${"line\n".repeat(100)}${PANE}` }),
}));
vi.mock("@/lib/tasks/gh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/gh")>()),
  run: async () => {
    throw new Error("no tmux here");
  },
  findPR: async () => ({
    number: 12,
    url: "https://github.com/o/r/pull/12",
    state: "OPEN",
    checks: "fail",
    head: "abc123",
    failing: "test",
  }),
}));

const { runTool } = await import("./serve");
const { readCards } = await import("./cards");

describe("the sessions tool", () => {
  it("lists every session with status, activity, task, PR and CI", async () => {
    const { workspace, app, api } = seedWorkspace("Tools");
    const text = await runTool(workspace.id, "sessions");
    const lines = text.split("\n");
    expect(lines[0]).toBe("2 sessions in Tools (2 needs input):");
    expect(text).toContain(`- chat-one (${app.name}, chat, id `);
    expect(text).toMatch(/chat-one .*: needs input, Fix the login/);
    expect(text).toContain(`- add-auth (${api.name}, terminal, id `);
    expect(text).toContain(
      "task blocked, PR #12 CI failed: test, BLOCKED: need the staging API key"
    );
    // Compact text, not JSON.
    expect(text).not.toMatch(/[{}]/);
  });

  it("names the stack position of a stacked task", async () => {
    const { db } = await import("@/lib/db");
    const { workspace, api, task } = seedWorkspace();
    db.prepare(
      `INSERT INTO stacks (id, project_id, lh_board_id, name) VALUES ('st1', ?, 'b', 'Auth')`
    ).run(api.id);
    db.prepare(
      `INSERT INTO stack_items (id, stack_id, position, lh_card_id, ticket, title, status, session_id)
       VALUES ('i1', 'st1', 0, 'c1', 'ROA-1', 'one', 'merged', NULL),
              ('i2', 'st1', 1, 'c2', 'ROA-2', 'two', 'pr', ?)`
    ).run(task);
    const text = await runTool(workspace.id, "sessions");
    expect(text).toContain('stack "Auth" 2/2 ROA-2 pr');
  });

  it("never lists an orchestrator, so it never hears about itself", async () => {
    const { db } = await import("@/lib/db");
    const { workspace, chat } = seedWorkspace();
    db.prepare(`UPDATE sessions SET role = 'orchestrator' WHERE id = ?`).run(
      chat
    );
    const text = await runTool(workspace.id, "sessions");
    expect(text).not.toContain("chat-one");
    expect(text.split("\n")[0]).toMatch(/^1 session in /);
  });

  it("says when nothing runs", async () => {
    const { createWorkspace } = await import("@/lib/workspaces");
    const w = createWorkspace("Quiet");
    expect(await runTool(w.id, "sessions")).toBe(
      "No sessions are running in Quiet."
    );
  });
});

describe("the read tool", () => {
  it("returns the end of a chat as plain text", async () => {
    const { workspace } = seedWorkspace();
    const text = await runTool(workspace.id, "read", { session: "chat-one" });
    expect(text).toBe(
      "chat-one (chat), last 60 lines:\n[user] Fix the login\n[assistant] Fixed it.\nTests pass.\n[turn ended]"
    );
    const two = await runTool(workspace.id, "read", {
      session: "chat-one",
      lines: 2,
    });
    expect(two.split("\n").slice(1)).toEqual(["Tests pass.", "[turn ended]"]);
  });

  it("returns the end of a terminal, by project/name or id prefix", async () => {
    const { workspace, api, task } = seedWorkspace();
    const byName = await runTool(workspace.id, "read", {
      session: `${api.name}/add-auth`,
      lines: 3,
    });
    expect(byName).toBe(
      "add-auth (terminal), last 3 lines:\nbuilding...\n⏺ BLOCKED: need the staging API key\n❯"
    );
    const byId = await runTool(workspace.id, "read", {
      session: task.slice(0, 8),
      lines: 1,
    });
    expect(byId.endsWith("❯")).toBe(true);
  });

  it("caps what it returns and refuses unknown sessions", async () => {
    const { tail, READ_CHAR_CAP } = await import("./read");
    const long = "x".repeat(READ_CHAR_CAP * 2);
    expect(tail(long, 10).length).toBe(READ_CHAR_CAP);
    const { workspace } = seedWorkspace();
    await expect(
      runTool(workspace.id, "read", { session: "nobody" })
    ).rejects.toThrow(/No session "nobody"/);
  });
});

describe("the cards tool", () => {
  const card = (over: Partial<LhCard>): LhCard => ({
    id: "c",
    ticket: null,
    board_id: "board-1",
    list_id: "l",
    list_name: "To Do",
    title: "t",
    description: null,
    position: 0,
    ...over,
  });
  const client = {
    listCards: async () => [
      card({ id: "a", ticket: "ROA-1", title: "Login page", position: 1 }),
      card({
        id: "b",
        ticket: "ROA-2",
        title: "Sessions API",
        list_name: "In Progress",
        position: 0,
        blocked_by: [{ id: "a", ticket: "ROA-1" }],
      }),
    ],
  };

  it("lists the linked boards' cards by list", async () => {
    const { workspace, app } = seedWorkspace();
    const text = await readCards(workspace.id, undefined, client);
    expect(text).toBe(
      [
        `Roadmap (project ${app.name}) (2 cards):`,
        "In Progress:",
        "  - ROA-2 Sessions API (blocked by ROA-1)",
        "To Do:",
        "  - ROA-1 Login page",
      ].join("\n")
    );
  });

  it("picks one board by name and explains what's missing", async () => {
    const { workspace } = seedWorkspace();
    expect(await readCards(workspace.id, "roadmap", client)).toContain(
      "ROA-1 Login page"
    );
    expect(await readCards(workspace.id, "other", client)).toBe(
      'No board "other". Linked boards: Roadmap.'
    );
    expect(await readCards(workspace.id, undefined, null)).toBe(
      "LumifyHub is not connected."
    );
  });
});
