import { describe, expect, it, vi } from "vitest";

// Three machines with a session called "main": this one, "box" (linked to
// its AgentOS) and "old" (reached over ssh only).
const ssh = vi.hoisted(() => [] as (string | null | undefined)[]);
const line = (name: string, title: string) =>
  [name, "100", "100", "/home/me", "0", "1", "zsh", "1", title].join("\t");
vi.mock("./hosts", () => ({
  listHosts: () => [{ id: "local" }, { id: "box" }, { id: "old" }],
  hostExecFile: async (hostId: string | null | undefined) => {
    ssh.push(hostId);
    return { stdout: line("main", hostId === "old" ? "old" : "here") };
  },
}));
vi.mock("./hosts/remote-api", () => ({
  hostLink: (id?: string) =>
    id === "box"
      ? { hostId: "box", hostName: "box", url: "http://box:3011", token: "t" }
      : null,
}));
vi.mock("./hosts/peer-sessions", () => ({
  peerTmuxSessions: async (link: { hostId: string }) => [
    {
      name: "main",
      hostId: link.hostId,
      activity: 1,
      output: 1,
      path: "~",
      attached: false,
      windows: 1,
      command: "zsh",
      title: "box",
      pid: 0,
    },
  ],
}));
vi.mock("./tmux/control", () => ({ controlManager: () => null }));

const { statusDetector } = await import("./status-detector");

describe("sessions on several machines", () => {
  it('lists each machine\'s "main": none hides another', async () => {
    const sessions = await statusDetector.listSessions();
    expect(sessions.map((s) => s.hostId).sort()).toEqual([
      "box",
      "local",
      "old",
    ]);
    expect(statusDetector.titleFor("main", "box")).toBe("box");
    expect(statusDetector.titleFor("main", "old")).toBe("old");
    // A bare name is this machine's.
    expect(statusDetector.titleFor("main")).toBe("here");
    expect(statusDetector.sessionExists("main", "box")).toBe(true);
    expect(statusDetector.sessionExists("main", "elsewhere")).toBe(false);
  });

  it("asks a linked machine's AgentOS, and ssh only for the unlinked one", () => {
    expect(ssh).toContain("old");
    expect(ssh).toContain("local");
    expect(ssh).not.toContain("box");
  });

  it("never reads a linked machine's screen over ssh", async () => {
    ssh.length = 0;
    expect(await statusDetector.captureScreen("main", true, "box")).toBe("");
    expect(ssh).toEqual([]);
  });
});
