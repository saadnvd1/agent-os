import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { updateSessionRow } from "@/lib/db";

const typed: string[] = [];
vi.mock("@/lib/status-detector", () => ({
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => true,
    getStatus: async () => "idle",
    titleFor: () => "",
  },
}));
vi.mock("@/lib/bus/delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./delivery")>()),
  deliverToPane: async (_pane: unknown, line: string) => {
    typed.push(line);
    return { state: "delivered" };
  },
}));
vi.mock("@/lib/chat/runner", () => ({
  sendChatConfirmed: async () => "delivered",
  chatState: () => null,
}));

const { db } = await import("@/lib/db");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { createWorkspace } = await import("@/lib/workspaces");
const bus = await import(".");

function workspaceWithOrchestrator(label: string) {
  const ws = createWorkspace(`${label}-${randomUUID().slice(0, 6)}`);
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const orch = seedSession({
    projectId: project.id,
    name: "orchestrator",
    view: "chat",
  });
  updateSessionRow(db, orch, { role: "orchestrator", workspace_id: ws.id });
  return { ws, project, orch };
}

describe("addressing across workspaces", () => {
  it("sends to <workspace>/orchestrator from a session in another workspace", async () => {
    const mine = workspaceWithOrchestrator("mine");
    const theirs = workspaceWithOrchestrator("theirs");
    const sender = seedSession({ projectId: mine.project.id, name: "worker" });
    updateSessionRow(db, sender, { workspace_id: mine.ws.id });
    const sent = await bus.sendMessage({
      fromId: sender,
      to: `${theirs.ws.name}/orchestrator`,
      body: "hello over there",
    });
    expect(sent.message.toId).toBe(theirs.orch);
    // And "orchestrator" is still the caller's own.
    expect(bus.resolveTarget("orchestrator", sender).session.id).toBe(
      mine.orch
    );
  });

  it("sends to <workspace>/<session>", () => {
    const theirs = workspaceWithOrchestrator("theirs");
    const worker = seedSession({
      projectId: theirs.project.id,
      name: `w-${randomUUID().slice(0, 6)}`,
    });
    updateSessionRow(db, worker, { workspace_id: theirs.ws.id });
    const name = (
      db.prepare(`SELECT name FROM sessions WHERE id = ?`).get(worker) as {
        name: string;
      }
    ).name;
    expect(bus.resolveTarget(`${theirs.ws.name}/${name}`).session.id).toBe(
      worker
    );
  });

  it("refuses a workspace name two workspaces share and lists both", () => {
    const one = workspaceWithOrchestrator("dup");
    const two = workspaceWithOrchestrator("other");
    db.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`).run(
      one.ws.name,
      two.ws.id
    );
    expect(() => bus.resolveTarget(`${one.ws.name}/orchestrator`)).toThrow(
      new RegExp(`matches 2 sessions.*${one.orch.slice(0, 8)}`)
    );
  });

  it("tells a caller with no workspace to use <workspace>/orchestrator", () => {
    const one = workspaceWithOrchestrator("solo");
    const loose = seedSession({ projectId: one.project.id, name: "loose" });
    updateSessionRow(db, loose, { workspace_id: null });
    expect(() => bus.resolveTarget("orchestrator", loose)).toThrow(
      new RegExp(`${one.ws.name}/orchestrator`)
    );
  });
});
