import { describe, expect, it } from "vitest";
import { parsePsTable, runsSomething, type ProcRow } from "./process-table";

const row = (pid: number, ppid: number, comm: string): ProcRow => ({
  pid,
  ppid,
  pcpu: 0,
  rss: 0,
  comm,
});

describe("process table", () => {
  it("reads ps lines, with spaces in the command name", () => {
    expect(
      parsePsTable(
        "  12     1  0.5  2048 /bin/zsh\n 40 12 12.0 900 Google Chrome Helper\nbad\n"
      )
    ).toEqual([
      { pid: 12, ppid: 1, pcpu: 0.5, rss: 2048, comm: "/bin/zsh" },
      { pid: 40, ppid: 12, pcpu: 12, rss: 900, comm: "Google Chrome Helper" },
    ]);
  });

  it("says a shell runs something when it has a child that isn't its own copy", () => {
    const rows = [row(10, 1, "/bin/zsh"), row(11, 10, "claude")];
    expect(runsSomething(rows, 10)).toBe(true);
    expect(runsSomething([row(10, 1, "-zsh")], 10)).toBe(false);
  });

  it("counts a pane it doesn't know as still running", () => {
    expect(runsSomething([row(10, 1, "/bin/zsh")], 99)).toBe(true);
  });

  it("doesn't count a prompt theme's idle copy of the shell", () => {
    const idle = [row(10, 1, "/bin/zsh"), row(11, 10, "zsh")];
    expect(runsSomething(idle, 10)).toBe(false);
    const busy = [...idle, row(12, 11, "git")];
    expect(runsSomething(busy, 10)).toBe(true);
  });
});
