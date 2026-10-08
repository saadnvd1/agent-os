import { afterEach, describe, expect, it, vi } from "vitest";

const ps = vi.hoisted(() => ({ out: "", fail: false, calls: 0 }));
vi.mock("child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string) => void
  ) => {
    ps.calls++;
    cb(ps.fail ? new Error("ps failed") : null, ps.fail ? "" : ps.out);
  },
}));

const { processTable, resetProcessTable } = await import("./process-table");

afterEach(() => {
  resetProcessTable();
  ps.fail = false;
  ps.calls = 0;
});

describe("processTable", () => {
  it("shares one read for a couple of seconds", async () => {
    ps.out = "10 1 0.0 100 /bin/zsh\n";
    expect(await processTable()).toHaveLength(1);
    expect(await processTable()).toHaveLength(1);
    expect(ps.calls).toBe(1);
  });

  it("gives no table for a failed or empty read, and waits before trying again", async () => {
    ps.fail = true;
    expect(await processTable()).toBeNull();
    ps.fail = false;
    ps.out = "10 1 0.0 100 /bin/zsh\n";
    // Backing off: not read again yet.
    expect(await processTable()).toBeNull();
    expect(ps.calls).toBe(1);
    resetProcessTable();
    ps.out = "";
    expect(await processTable()).toBeNull();
  });
});
