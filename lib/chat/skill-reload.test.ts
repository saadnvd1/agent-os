import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import type { ChatServerMessage } from "./events";
import { registry } from "./registry";
import { sleep, touchUntil } from "./test-touch";

const tmp = (prefix: string) =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
// The user's skills, not the real ~/.claude's.
process.env.CLAUDE_CONFIG_DIR = tmp("skr-home-");

// Each discovery reads the project's skill folder, as Claude Code does. A
// test can hold one open, after it has read, with `gate`.
let gate: Promise<void> | null = null;
const discover = vi.fn(
  async ({ cwd }: { cwd: string; signal?: AbortSignal }) => {
    const dir = path.join(cwd, ".claude", "skills");
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    if (gate) await gate;
    return {
      commands: names.map((name) => ({ name, description: "" })),
      models: [],
    };
  }
);
vi.mock("./drivers", () => ({
  chatDriverFor: () => ({ id: "claude", discover }),
}));

const {
  capsKey,
  refreshCapabilities,
  releaseUnwatchedSoon,
  reloadOnChange,
  reloadCapabilities,
  sendCapabilities,
} = await import("./settings");
const g = globalThis as unknown as {
  __agentosSkillWatch: { watcher: { keys(): string[] } };
};
const watchedKeys = () => g.__agentosSkillWatch.watcher.keys();

// An open chat on a session in a project of its own.
async function openChat() {
  const cwd = tmp("skr-");
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, agent_type) VALUES (?, 'chat', ?, ?, 'claude')`
    )
    .run(id, `claude-${id}`, cwd);
  const got: string[][] = [];
  const listener = (m: ChatServerMessage) => {
    if (m.type === "capabilities") got.push(m.commands.map((c) => c.name));
  };
  registry.listeners.set(id, new Set([listener]));
  await sendCapabilities(id, listener);
  const key = capsKey({
    agent_type: "claude",
    working_directory: cwd,
  } as never);
  return { id, cwd, got, key };
}

afterEach(() => {
  registry.listeners.clear();
  discover.mockClear();
  gate = null;
});

describe("chat commands", { timeout: 45_000 }, () => {
  it("reloads and tells the chat when a skill is added", async () => {
    const { cwd, got } = await openChat();
    expect(got).toEqual([[]]);
    expect(discover).toHaveBeenCalledTimes(1);
    // Past the watcher's start-up, then a skill in a folder that wasn't there
    // (made anew each time, should the first go unseen).
    await sleep(700);
    await touchUntil(
      () => {
        fs.rmSync(path.join(cwd, ".claude"), { recursive: true, force: true });
        fs.mkdirSync(path.join(cwd, ".claude", "skills", "new-skill"), {
          recursive: true,
        });
      },
      () => got.some((names) => names.includes("new-skill"))
    );
  });

  it("refresh loads again past the cache", async () => {
    const { id, got } = await openChat();
    expect(discover).toHaveBeenCalledTimes(1);
    // Within the TTL, a second chat on it reads the cache.
    await sendCapabilities(id, () => {});
    expect(discover).toHaveBeenCalledTimes(1);
    await refreshCapabilities(id);
    expect(discover).toHaveBeenCalledTimes(2);
    expect(got).toHaveLength(2);
  });

  it("runs a reload asked for mid-reload once after it, not alongside", async () => {
    const { key, cwd, got } = await openChat();
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const first = reloadCapabilities(key);
    // Added while the first discovery is under way: it may have missed it.
    fs.mkdirSync(path.join(cwd, ".claude", "skills", "late"), {
      recursive: true,
    });
    const second = reloadCapabilities(key);
    const third = reloadCapabilities(key);
    await sleep(50);
    expect(discover).toHaveBeenCalledTimes(2); // the open and the first reload
    open();
    await Promise.all([first, second, third]);
    expect(discover).toHaveBeenCalledTimes(3);
    expect(got.at(-1)).toEqual(["late"]);
  });

  it("an older load finishing late doesn't undo a newer one", async () => {
    const { id, key, cwd, got } = await openChat();
    // The cache expires and another chat opening starts a load, which reads
    // the folder and then takes its time.
    registry.caps.get(key)!.at = 0;
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const slow = sendCapabilities(id, () => {});
    await sleep(10);
    gate = null;
    fs.mkdirSync(path.join(cwd, ".claude", "skills", "fresh"), {
      recursive: true,
    });
    await reloadCapabilities(key);
    open();
    await slow;
    expect(discover).toHaveBeenCalledTimes(3);
    expect(registry.caps.get(key)?.commands.map((c) => c.name)).toEqual([
      "fresh",
    ]);
    expect(got.at(-1)).toEqual(["fresh"]);
  });

  it("a change many chats read reloads them a few at a time", async () => {
    const chats = [await openChat(), await openChat(), await openChat()];
    discover.mockClear();
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const all = Promise.all(chats.map((c) => reloadOnChange(c.key)));
    await sleep(50);
    expect(discover).toHaveBeenCalledTimes(2);
    open();
    await all;
    expect(discover).toHaveBeenCalledTimes(3);
  });

  it("ends a discovery that hangs, and frees the key's reloads", async () => {
    const { id, key } = await openChat();
    let aborted = false;
    discover.mockImplementationOnce(
      ({ signal }: { cwd: string; signal?: AbortSignal }) =>
        new Promise((_, reject) =>
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          })
        )
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const hung = refreshCapabilities(id).catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await hung).toBe("Discovery timed out");
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    // The next reload runs rather than waiting on the hung one.
    await reloadCapabilities(key);
    expect(discover).toHaveBeenCalledTimes(3);
  });

  it("stops watching a folder nobody has a chat open on", async () => {
    const { key } = await openChat();
    expect(watchedKeys()).toContain(key);
    registry.listeners.clear();
    await reloadCapabilities(key);
    expect(registry.caps.has(key)).toBe(false);
    expect(watchedKeys()).not.toContain(key);
  });

  it("the sweep releases only folders whose chats closed", async () => {
    const a = await openChat();
    const b = await openChat();
    registry.listeners.delete(a.id);
    releaseUnwatchedSoon(0);
    await sleep(20);
    expect(watchedKeys()).not.toContain(a.key);
    expect(watchedKeys()).toContain(b.key);
  });
});
