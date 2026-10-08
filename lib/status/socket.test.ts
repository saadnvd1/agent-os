import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { polledDirs, unwatchGit } from "../git-poller";
import {
  onStatusMessage,
  serveStatusSocket,
  sessionFolder,
  streamParams,
} from "./socket";

const p = (q: string) => new URLSearchParams(q);

describe("streamParams", () => {
  it("reads a resume position only when both parts are sound", () => {
    expect(streamParams(p("v=2&epoch=e1&seq=12"))).toEqual({
      stream: true,
      resume: { epoch: "e1", seq: 12 },
    });
    expect(streamParams(p("v=2&epoch=e1"))).toEqual({ stream: true });
    expect(streamParams(p("v=2&seq=3"))).toEqual({ stream: true });
    expect(streamParams(p("v=2&epoch=e1&seq=abc"))).toEqual({ stream: true });
    expect(streamParams(p("v=2&epoch=e1&seq=-1"))).toEqual({ stream: true });
    expect(streamParams(p("v=2&epoch=e1&seq=1.5"))).toEqual({ stream: true });
    expect(streamParams(p(""))).toEqual({ stream: false });
  });
});

describe("status socket messages", () => {
  const watcher = {};
  afterEach(() => unwatchGit(watcher));

  it("takes watch_git and ignores anything else", () => {
    onStatusMessage(watcher, "not json");
    onStatusMessage(watcher, JSON.stringify({ type: "other", dirs: ["/a"] }));
    expect(polledDirs()).toEqual([]);
    onStatusMessage(
      watcher,
      JSON.stringify({ type: "watch_git", dirs: ["/srv/x"] })
    );
    expect(polledDirs()).toEqual(["/srv/x"]);
  });

  it("stops polling a socket's folders and pinging once it closes", () => {
    vi.useFakeTimers();
    try {
      const ws = new EventEmitter();
      const sent: string[] = [];
      serveStatusSocket(ws, p("v=2"), (json) => void sent.push(json));
      ws.emit(
        "message",
        Buffer.from(JSON.stringify({ type: "watch_git", dirs: ["/srv/y"] }))
      );
      expect(polledDirs()).toEqual(["/srv/y"]);
      vi.advanceTimersByTime(25_000);
      expect(sent).toContain(JSON.stringify({ type: "ping" }));
      ws.emit("close");
      expect(polledDirs()).toEqual([]);
      const count = sent.length;
      vi.advanceTimersByTime(60_000);
      expect(sent).toHaveLength(count);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sessionFolder", () => {
  it("prefers the worktree over the project folder", async () => {
    const { getDb } = await import("@/lib/db");
    const { seedSession } = await import("../orchestrator/testing");
    const { createProject } = await import("../projects");
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: "/tmp/p",
    });
    const id = seedSession({ projectId: project.id, name: "s" });
    expect(sessionFolder(id)).toBe("/tmp");
    getDb()
      .prepare(`UPDATE sessions SET worktree_path = ? WHERE id = ?`)
      .run("/tmp/wt", id);
    expect(sessionFolder(id)).toBe("/tmp/wt");
    expect(sessionFolder("missing")).toBeNull();
  });
});
