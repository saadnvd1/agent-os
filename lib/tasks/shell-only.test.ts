import { describe, expect, it, vi } from "vitest";

const pane = vi.hoisted(() => ({
  host: "local" as string | undefined,
  cmd: "zsh" as string | undefined,
  pid: 10 as number | undefined,
}));
vi.mock("../status-detector", () => ({
  statusDetector: {
    hostFor: () => pane.host,
    foregroundFor: () => pane.cmd,
    paneProcess: () => pane.pid,
  },
}));
const table = vi.hoisted(() => ({
  rows: null as
    | null
    | { pid: number; ppid: number; pcpu: number; rss: number; comm: string }[],
}));
vi.mock("../process-table", async (original) => ({
  ...(await original<typeof import("../process-table")>()),
  processTable: async () => table.rows,
}));

const { shellOnly } = await import("./index");

const row = (pid: number, ppid: number, comm: string) => ({
  pid,
  ppid,
  pcpu: 0,
  rss: 0,
  comm,
});

describe("shellOnly: whether a task's agent has exited", () => {
  it("is when nothing runs under the pane's shell", async () => {
    table.rows = [row(10, 1, "/bin/zsh")];
    expect(await shellOnly("t")).toBe(true);
    table.rows = [row(10, 1, "/bin/zsh"), row(11, 10, "claude")];
    expect(await shellOnly("t")).toBe(false);
  });

  it("isn't when anything is unknown: no table, no pane, another machine", async () => {
    table.rows = null;
    expect(await shellOnly("t")).toBe(false);
    table.rows = [row(10, 1, "/bin/zsh")];
    pane.host = "box";
    expect(await shellOnly("t")).toBe(false);
    pane.host = "local";
    pane.pid = 99;
    expect(await shellOnly("t")).toBe(false);
    pane.pid = 10;
    pane.cmd = "node";
    expect(await shellOnly("t")).toBe(false);
    pane.cmd = "zsh";
  });
});
