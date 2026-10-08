import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({
  branch: "main",
  fail: false,
  calls: 0,
}));
vi.mock("./git-status", () => ({
  expandPath: (p: string) => p.replace(/^~/, "/home/me"),
  getGitStatus: vi.fn(async () => {
    status.calls++;
    if (status.fail) throw new Error("git failed");
    return {
      branch: status.branch,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
    };
  }),
}));
const topics = vi.hoisted(() => [] as string[]);
vi.mock("./status/hub", () => ({ notifyTopic: (t: string) => topics.push(t) }));

const poller = await import("./git-poller");

const viewer = {};
const other = {};

beforeEach(() => {
  vi.useFakeTimers();
  status.branch = "main";
  status.fail = false;
  status.calls = 0;
  topics.length = 0;
});
afterEach(() => {
  poller.unwatchGit(viewer);
  poller.unwatchGit(other);
  vi.useRealTimers();
});

describe("git poller", () => {
  it("polls the folders viewers show, once each, and stops when they leave", () => {
    poller.watchGit(viewer, ["~/app", "/srv/api"]);
    poller.watchGit(other, ["/home/me/app"]);
    expect(poller.polledDirs().sort()).toEqual(["/home/me/app", "/srv/api"]);
    poller.unwatchGit(viewer);
    expect(poller.polledDirs()).toEqual(["/home/me/app"]);
    poller.unwatchGit(other);
    expect(poller.polledDirs()).toEqual([]);
  });

  it("ignores junk in a watch list and caps its length", () => {
    poller.watchGit(viewer, [
      42,
      "",
      "x".repeat(2000),
      ...Array.from({ length: 80 }, (_, i) => `/d${i}`),
    ]);
    expect(poller.polledDirs()).toHaveLength(50);
    poller.watchGit(viewer, "not a list");
    expect(poller.polledDirs()).toEqual([]);
  });

  it("shares a read for a couple of seconds, then reads again", async () => {
    await poller.sharedGitStatus("/srv/share");
    await poller.sharedGitStatus("/srv/share");
    expect(status.calls).toBe(1);
    vi.advanceTimersByTime(2500);
    await poller.sharedGitStatus("/srv/share");
    expect(status.calls).toBe(2);
    poller.forgetGitStatus("/srv/share");
    await poller.sharedGitStatus("/srv/share");
    expect(status.calls).toBe(3);
  });

  it("pushes a change under each name viewers gave the folder", async () => {
    poller.watchGit(viewer, ["~/push"]);
    poller.watchGit(other, ["/home/me/push"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(topics).toEqual([]);
    status.branch = "feature";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(topics.sort()).toEqual(["git:/home/me/push", "git:~/push"]);
  });

  it("backs off while git fails and looks again at once after a run", async () => {
    status.fail = true;
    poller.watchGit(viewer, ["/srv/broken"]);
    await vi.advanceTimersByTimeAsync(5000);
    const first = status.calls;
    expect(first).toBe(1);
    // Next try after 60s, not 30s.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(status.calls).toBe(first);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(status.calls).toBe(first + 1);
    poller.refreshGitSoon("/srv/broken");
    await vi.advanceTimersByTimeAsync(5000);
    expect(status.calls).toBe(first + 2);
  });
});
