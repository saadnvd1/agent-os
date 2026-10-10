import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import type { ChatServerMessage } from "./events";
import { registry } from "./registry";
import { touchUntil } from "./test-touch";

// Each discovery reads the project's skill folder, as Claude Code does.
const discover = vi.fn(async ({ cwd }: { cwd: string }) => {
  const dir = path.join(cwd, ".claude", "skills");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  return {
    commands: names.map((name) => ({ name, description: "" })),
    models: [],
  };
});
vi.mock("./drivers", () => ({
  chatDriverFor: () => ({ id: "claude", discover }),
}));

const { refreshCapabilities, sendCapabilities } = await import("./settings");

// An open chat on a session in a project of its own.
async function openChat() {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skr-")));
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
  return { id, cwd, got };
}

afterEach(() => {
  registry.listeners.clear();
  discover.mockClear();
});

describe("chat commands", { timeout: 45_000 }, () => {
  it("reloads and tells the chat when a skill is added", async () => {
    const { cwd, got } = await openChat();
    expect(got).toEqual([[]]);
    expect(discover).toHaveBeenCalledTimes(1);
    // Past the watcher's start-up, then a skill in a folder that wasn't there.
    await new Promise((r) => setTimeout(r, 700));
    let n = 0;
    await touchUntil(
      () =>
        fs.mkdirSync(path.join(cwd, ".claude", "skills", `skill-${++n}`), {
          recursive: true,
        }),
      () => got.some((names) => names.includes("skill-1"))
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
});
