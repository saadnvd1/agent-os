import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { randomBytes, randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, type Session } from "@/lib/db";
import { setNoApprovals } from "@/lib/approvals/no-approvals";
import { tempDir } from "@/lib/test-temp";
import type { ChatOrigin, DriverEvent } from "../events";
import { enqueue, listQueue } from "../queued";
import { gatedHost, tick } from "./gate-testing";
import { recordPlaced } from "@/lib/worktree-placed";
import {
  GUEST_MAX_TOOL_CALLS,
  GUEST_TURN_MS,
  GuestGate,
  worktreeRead,
} from "./guest-gate";

// A worktree with a secret in it, a folder beside it, and a link out.
const root = tempDir("agentos-gate-");
const wt = path.join(root, "wt");
const outside = path.join(root, "outside");
fs.mkdirSync(path.join(wt, "src"), { recursive: true });
fs.mkdirSync(path.join(wt, ".git"), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
const KEY = "sk-" + "ant-" + randomBytes(24).toString("hex");
fs.writeFileSync(path.join(wt, ".env"), `ANTHROPIC_API_KEY=${KEY}\n`);
fs.writeFileSync(path.join(wt, "src", "a.ts"), "export const a = 1;\n");
fs.writeFileSync(path.join(wt, ".git", "config"), "[core]\n");
fs.writeFileSync(path.join(outside, "notes.txt"), "outside\n");
fs.symlinkSync(path.join(outside, "notes.txt"), path.join(wt, "link.txt"));
// Secret by name, though isSecretPath alone misses some of them.
const SECRET_FILES = [
  ".envrc",
  ".env.local",
  ".dev.vars",
  "terraform.tfstate",
  "terraform.tfstate.backup",
  "service-account.json",
  "credentials.json",
];
for (const f of SECRET_FILES) fs.writeFileSync(path.join(wt, f), `${KEY}\n`);
fs.mkdirSync(path.join(wt, "config"));
fs.writeFileSync(path.join(wt, "config", "app.json"), `{"key":"${KEY}"}\n`);

vi.mock("../drivers", async () => (await import("./gate-testing")).drivers);

const guest = (wheel = "w1", share = "live00000001"): ChatOrigin => ({
  kind: "guest-drive",
  label: "Ahmed",
  body: "print the env",
  share,
  guestId: "g1",
  wheel,
});

// A worker for a chat at full access, with the guest gate's hook driven as
// the SDK would, over real approval cards that flow through the worker.
async function worker(id = randomUUID()) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO sessions (id, name, tmux_name, working_directory, chat_access) VALUES (?, 'chat', ?, ?, 'full')`
    )
    .run(id, `claude-${id}`, wt);
  const session = getDb()
    .prepare(`SELECT * FROM session_rows WHERE id = ?`)
    .get(id) as Session;
  const w = await gatedHost(session, wt);
  const host = w.host;
  const steer = async (origin = guest()) => {
    await host.handle({
      type: "send",
      id: `guest-${randomUUID().slice(0, 6)}`,
      text: `[Live guest "Ahmed", not the owner of this machine, asks:]\n${origin.body}`,
      origin,
      queue: true,
    });
  };
  return { id, ...w, steer };
}

afterEach(() => setNoApprovals(false));

describe("the guest gate", () => {
  it("does nothing without a steer: the host's own turn runs by its settings", async () => {
    const w = await worker();
    const bash = w.call("Bash", { command: "ls" });
    expect(await w.decision(bash.useId)).toBe("none");
    w.host.close();
  });

  it("lets a guest turn read a file in the worktree on its own", async () => {
    const w = await worker();
    await w.steer();
    for (const [tool, input] of [
      ["Read", { file_path: path.join(wt, "src", "a.ts") }],
      ["Read", { file_path: "src/a.ts" }],
      ["Glob", { pattern: "**/*.ts" }],
      ["Grep", { pattern: "a", path: ".", type: "ts" }],
      ["Grep", { pattern: "a", path: "src", type: "ts" }],
      ["Grep", { pattern: "a", path: "src/a.ts" }],
      ["TodoWrite", { todos: [] }],
    ] as const) {
      const c = w.call(tool, input);
      expect(
        await w.decision(c.useId),
        `${tool} ${JSON.stringify(input)}`
      ).toBe("allow");
      expect(w.card(c.useId)).toBeUndefined();
    }
    w.host.close();
  });

  it("★ makes a card of a read of .env, ../outside, a link out, ~/.ssh and .git", async () => {
    const w = await worker();
    await w.steer();
    for (const input of [
      { file_path: path.join(wt, ".env") },
      { file_path: ".env" },
      { file_path: "../outside/notes.txt" },
      { file_path: path.join(wt, "link.txt") },
      { file_path: path.join(os.homedir(), ".ssh", "id_ed25519") },
      { file_path: "~/.ssh/id_ed25519" },
      { file_path: ".git/config" },
      { file_path: path.join(wt, "src") },
      ...SECRET_FILES.map((f) => ({ file_path: f })),
    ]) {
      const c = w.call("Read", input);
      expect(await w.decision(c.useId), JSON.stringify(input)).toBe("pending");
      expect(w.card(c.useId)).toMatchObject({
        status: "pending",
        guest: { name: "Ahmed" },
        canAlways: false,
      });
    }
    // A search that could reach the env file, or patterns that climb out.
    for (const [tool, input] of [
      ["Grep", { pattern: "sk-ant" }],
      ["Grep", { pattern: "sk-ant", type: "ts" }],
      ["Grep", { pattern: "sk-ant", path: ".", glob: "*" }],
      ["Grep", { pattern: "sk-ant", path: ".", glob: "*.ts" }],
      ["Grep", { pattern: "sk-ant", path: ".", glob: ".env", type: "ts" }],
      ["Grep", { pattern: "sk-ant", glob: "*.env" }],
      ["Grep", { pattern: "x", path: ".env" }],
      ["Grep", { pattern: "x", path: ".envrc" }],
      ["Grep", { pattern: "x", path: ".", type: "all" }],
      ["Grep", { pattern: "x", path: outside, type: "txt" }],
      ["Glob", { pattern: "../**/*" }],
      ["Glob", { pattern: "src/../../outside/*" }],
      ["Glob", { pattern: "{src,..}/*" }],
      ["Glob", { pattern: "/etc/*" }],
      ["Glob", { pattern: "*", path: outside }],
    ] as const) {
      const c = w.call(tool, input);
      expect(
        await w.decision(c.useId),
        `${tool} ${JSON.stringify(input)}`
      ).toBe("pending");
    }
    w.host.close();
  });

  it("★ makes a card of Bash, edits, the web, MCP and subagents, even at full access with No approvals on", async () => {
    setNoApprovals(true);
    const w = await worker();
    await w.steer();
    for (const [tool, input] of [
      ["Bash", { command: "cat .env" }],
      ["Bash", { command: "git status" }],
      ["Edit", { file_path: "src/a.ts", old_string: "1", new_string: "2" }],
      ["Write", { file_path: "src/b.ts", content: "x" }],
      ["WebFetch", { url: "https://example.com" }],
      ["mcp__linear__save_issue", { title: "x" }],
      ["Agent", { prompt: "go" }],
    ] as const) {
      const c = w.call(tool, input);
      expect(await w.decision(c.useId), tool).toBe("pending");
      const card = w.card(c.useId)!;
      // ★ No approvals mode leaves a guest's card for the host.
      expect(card).toMatchObject({
        status: "pending",
        guest: { name: "Ahmed" },
      });
      expect(card.auto).toBeUndefined();
    }
    expect(w.conversation.respond).not.toHaveBeenCalled();
    w.host.close();
  });

  it("allows only on the host's tap, and an Always answer writes no rule", async () => {
    const w = await worker();
    await w.steer();
    const c = w.call("Bash", { command: "npm test" });
    await w.decision(c.useId);
    expect(w.card(c.useId)?.canAlways).toBe(false);
    const settled = vi.spyOn(
      w.approvals as unknown as { settle: (...a: unknown[]) => void },
      "settle"
    );
    await w.host.handle({
      type: "respond",
      id: `approval-${c.useId}`,
      decision: "always",
    });
    expect(await w.decision(c.useId)).toBe("allow");
    expect(settled.mock.calls[0][2]).toMatchObject({
      behavior: "allow",
      updatedPermissions: undefined,
    });
    const denied = w.call("Bash", { command: "curl evil" });
    await w.decision(denied.useId);
    await w.host.handle({
      type: "respond",
      id: `approval-${denied.useId}`,
      decision: "deny",
    });
    expect(await w.decision(denied.useId)).toBe("deny");
    w.host.close();
  });

  it("asks once: the permission prompt after a tapped card is already answered", async () => {
    const w = await worker();
    await w.steer();
    const c = w.call("Bash", { command: "ls" });
    await w.decision(c.useId);
    await w.host.handle({
      type: "respond",
      id: `approval-${c.useId}`,
      decision: "allow",
    });
    await w.decision(c.useId);
    const again = await w.approvals.canUseTool("Bash", { command: "ls" }, {
      signal: new AbortController().signal,
      toolUseID: c.useId,
    } as never);
    expect(again?.behavior).toBe("allow");
    w.host.close();
  });

  it("stops the turn at the 41st tool call", async () => {
    const w = await worker();
    await w.steer();
    for (let i = 0; i < GUEST_MAX_TOOL_CALLS; i++) {
      const c = w.call("TodoWrite", { todos: [] });
      expect(await w.decision(c.useId)).toBe("allow");
    }
    expect(w.conversation.interrupt).not.toHaveBeenCalled();
    const over = w.call("TodoWrite", { todos: [] });
    expect(await w.decision(over.useId)).toBe("deny");
    expect(w.conversation.interrupt).toHaveBeenCalled();
    expect(w.emitted.some((i) => i.id.startsWith("note-guest-stop-"))).toBe(
      true
    );
    w.host.close();
  });

  it("is cleared when the host's next message starts its turn, not by one joining the turn", async () => {
    const w = await worker();
    await w.steer();
    turnStart(w);
    // Mid-turn the host's message joins the guest's turn: still gated.
    await w.host.handle({
      type: "send",
      id: "host-mid",
      text: "also this",
      host: true,
    });
    expect(w.gate.steer).not.toBeNull();
    await w.idle();
    // An agent's message starting a turn isn't the host speaking.
    await w.host.handle({
      type: "send",
      id: "peer-1",
      text: "from another agent",
      origin: { kind: "peer", label: "x" },
    });
    turnStart(w);
    expect(w.gate.steer).not.toBeNull();
    await w.idle();
    await w.host.handle({
      type: "send",
      id: "host-1",
      text: "carry on",
      host: true,
    });
    // Sent, but its turn hasn't started: what runs till then is gated.
    expect(w.gate.steer).not.toBeNull();
    turnStart(w);
    await tick();
    expect(w.gate.steer).toBeNull();
    const c = w.call("Bash", { command: "ls" });
    expect(await w.decision(c.useId)).toBe("none");
    w.host.close();
  });

  it("★ keeps the steer through automated messages AgentOS sends with a host-like origin", async () => {
    const w = await worker();
    await w.steer();
    turnStart(w);
    for (const [id, origin] of [
      ["resume", { kind: "decision", label: "Resumed on opus" }],
      ["plan-step", { kind: "decision", label: "Plan step" }],
      ["analyst", { kind: "decision", label: "Analyst" }],
      ["device", { kind: "device", label: "Phone" }],
      ["event", { kind: "event", label: "AgentOS" }],
    ] as const) {
      await w.idle();
      await w.host.handle({ type: "send", id, text: "go on", origin });
      turnStart(w);
      expect(w.gate.steer, id).not.toBeNull();
    }
    // Nor does a host flag on another agent's message.
    await w.idle();
    await w.host.handle({
      type: "send",
      id: "peer-host",
      text: "x",
      from: "other",
      host: true,
    });
    turnStart(w);
    expect(w.gate.steer).not.toBeNull();
    const c = w.call("Bash", { command: "ls" });
    expect(await w.decision(c.useId)).toBe("pending");
    w.host.close();
  });

  it("★ keeps a stopped guest turn's wind-down gated after Send now: cleared only at the host's turn", () => {
    const gate = new GuestGate(() => {});
    gate.onSend({ origin: guest() }, false);
    gate.onTurnStart();
    // Send now: the guest's turn is still winding down.
    gate.onSend({ host: true }, false, 0);
    expect(gate.steer).not.toBeNull();
    gate.onTurnStart();
    expect(gate.steer).toBeNull();
    // Sent before the guest's turn even started: that turn comes first.
    gate.onSend({ origin: guest() }, false);
    gate.onSend({ host: true }, false, 1);
    gate.onTurnStart();
    expect(gate.steer).not.toBeNull();
    gate.onTurnStart();
    expect(gate.steer).toBeNull();
    gate.close();
  });

  it("★ keeps its steer across a worker restart", async () => {
    const w = await worker();
    await w.steer();
    w.host.close();
    const again = await worker(w.id);
    expect(again.gate.steer).toMatchObject({
      shareId: "live00000001",
      wheel: "w1",
      guestId: "g1",
      name: "Ahmed",
    });
    const c = again.call("Bash", { command: "cat .env" });
    expect(await again.decision(c.useId)).toBe("pending");
    expect(again.card(c.useId)?.guest).toEqual({ name: "Ahmed" });
    // The host's own turn ends it, for the next worker too.
    await again.idle();
    await again.host.handle({
      type: "send",
      id: "host-x",
      text: "mine",
      host: true,
    });
    turnStart(again);
    await tick();
    expect(again.gate.steer).toBeNull();
    again.host.close();
    expect((await worker(w.id)).gate.steer).toBeNull();
  });

  it("★ denies when the gate throws", async () => {
    const w = await worker();
    await w.steer();
    vi.spyOn(w.approvals, "askGuest").mockRejectedValue(new Error("boom"));
    const c = w.call("Bash", { command: "cat .env" });
    expect(await w.decision(c.useId)).toBe("deny");
    vi.spyOn(w.gate, "placedFiles").mockImplementation(() => {
      throw new Error("boom");
    });
    const r = w.call("Read", { file_path: "src/a.ts" });
    expect(await w.decision(r.useId)).toBe("deny");
    w.host.close();
  });

  it("★ denies a guest card once the guest's 20 minutes are up, before the SDK's hook timeout", async () => {
    const w = await worker();
    await w.steer();
    w.gate.steer!.startedAt = Date.now() - GUEST_TURN_MS - 1;
    const late = w.call("Bash", { command: "ls" });
    expect(await w.decision(late.useId)).toBe("deny");
    // One asked just before the limit expires at it.
    w.gate.steer!.startedAt = Date.now() - GUEST_TURN_MS + 80;
    const c = w.call("Bash", { command: "ls" });
    expect(await w.decision(c.useId)).toBe("pending");
    await vi.waitFor(async () =>
      expect(await w.decision(c.useId)).toBe("deny")
    );
    expect(w.card(c.useId)?.status).toBe("expired");
    w.host.close();
  });

  it("keeps a background task's follow-up turn gated", async () => {
    const w = await worker();
    await w.steer();
    await w.idle();
    // The agent starts a turn of its own (a task's notice).
    w.conversation.events.push({ type: "turn_start" } as DriverEvent);
    await tick();
    const c = w.call("Bash", { command: "rm -rf build" });
    expect(await w.decision(c.useId)).toBe("pending");
    w.host.close();
  });

  it("★ on release: its cards expire denied, its queue goes, the turn stops, and that wheel is refused", async () => {
    const w = await worker();
    await w.steer();
    const c = w.call("Bash", { command: "cat .env" });
    await w.decision(c.useId);
    enqueue(w.id, {
      id: "guest-q2",
      text: "next",
      origin: guest(),
    });
    enqueue(w.id, { id: "host-q", text: "mine" });
    await w.host.handle({
      type: "guest_release",
      share: "live00000001",
      wheel: "w1",
    });
    expect(await w.decision(c.useId)).toBe("deny");
    expect(w.card(c.useId)?.status).toBe("expired");
    expect(listQueue(w.id).map((q) => q.id)).toEqual(["host-q"]);
    expect(w.conversation.interrupt).toHaveBeenCalled();
    // Still gated until the host speaks.
    expect(w.gate.steer).not.toBeNull();
    await w.idle();
    w.conversation.send.mockClear();
    await w.host.handle({
      type: "send",
      id: "guest-late",
      text: "late",
      origin: guest(),
      queue: true,
    });
    expect(w.conversation.send).not.toHaveBeenCalled();
    expect(listQueue(w.id).some((q) => q.id === "guest-late")).toBe(false);
    // A new wheel on the same share is a new Drive: taken in, and since
    // the host's queued message runs now, it waits its own turn.
    await w.steer(guest("w2"));
    expect(listQueue(w.id).map((q) => q.guest?.name)).toEqual(["Ahmed"]);
    w.host.close();
  });

  it("refuses a guest message that names no wheel", async () => {
    const w = await worker();
    await w.host.handle({
      type: "send",
      id: "guest-x",
      text: "hi",
      origin: { kind: "guest-drive", label: "Ahmed", share: "live00000001" },
    });
    expect(w.conversation.send).not.toHaveBeenCalled();
    expect(w.gate.steer).toBeNull();
    w.host.close();
  });

  it("the guest's Stop ends only a turn their wheel steers", async () => {
    const w = await worker();
    await w.host.handle({ type: "send", id: "host-0", text: "mine" });
    await w.host.handle({
      type: "guest_stop",
      share: "live00000001",
      wheel: "w1",
    });
    expect(w.conversation.interrupt).not.toHaveBeenCalled();
    await w.idle();
    await w.steer();
    await w.host.handle({
      type: "guest_stop",
      share: "live00000001",
      wheel: "other",
    });
    expect(w.conversation.interrupt).not.toHaveBeenCalled();
    await w.host.handle({
      type: "guest_stop",
      share: "live00000001",
      wheel: "w1",
    });
    expect(w.conversation.interrupt).toHaveBeenCalled();
    w.host.close();
  });
});

function turnStart(w: {
  conversation: { events: { push(e: DriverEvent): void } };
}) {
  w.conversation.events.push({ type: "turn_start" } as DriverEvent);
}

describe("worktreeRead", () => {
  it("★ refuses files AgentOS copied into the worktree, and searches over them", () => {
    const placed = new Set([path.join("config", "app.json")]);
    const read = (tool: string, input: Record<string, unknown>) =>
      worktreeRead(tool, input, wt, placed);
    expect(read("Read", { file_path: "config/app.json" })).toBe(false);
    expect(read("Grep", { pattern: "key", path: "config/app.json" })).toBe(
      false
    );
    expect(read("Grep", { pattern: "key", path: "config", type: "json" })).toBe(
      false
    );
    expect(read("Grep", { pattern: "key", path: ".", type: "json" })).toBe(
      false
    );
    expect(read("Grep", { pattern: "a", path: "src", type: "ts" })).toBe(true);
    expect(read("Read", { file_path: "src/a.ts" })).toBe(true);
  });

  it("reads what env setup recorded as placed", async () => {
    const repo = tempDir("agentos-gate-repo-");
    const src = tempDir("agentos-gate-src-");
    execFileSync("git", ["init", "-q", repo]);
    for (const dir of [repo, src])
      fs.writeFileSync(path.join(dir, ".dev.vars"), `${KEY}\n`);
    await recordPlaced(repo, src, [".dev.vars"]);
    const gate = new GuestGate(() => {});
    expect([...(await gate.placedFiles(repo))]).toEqual([".dev.vars"]);
  });

  it("is false for anything but the four read tools", () => {
    expect(worktreeRead("Bash", { command: "cat src/a.ts" }, wt)).toBe(false);
    expect(
      worktreeRead("NotebookRead", { notebook_path: "src/a.ts" }, wt)
    ).toBe(false);
    expect(worktreeRead("Read", {}, wt)).toBe(false);
    expect(
      worktreeRead("Read", { file_path: "src/a.ts" }, "/no/such/dir")
    ).toBe(false);
  });
});
