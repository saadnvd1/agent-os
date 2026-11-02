import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { plan, limits, parseSize, hitCap, capMessage } = createRequire(
  import.meta.url
)("../../bin/aos-lib/heavy-scope.js");

const GB = 1024 ** 3;
const has = () => "/usr/bin/systemd-run";

describe("heavy scope plan", () => {
  it("wraps a command in a capped systemd scope on Linux", () => {
    const p = plan(["npm", "test"], {
      platform: "linux",
      which: has,
      env: {},
      totalmem: 16 * GB,
    });
    expect(p.scoped).toBe(true);
    expect(p.cmd).toBe("systemd-run");
    expect(p.args).toEqual([
      "--user",
      "--scope",
      "--quiet",
      "-p",
      "MemoryHigh=5570M",
      "-p",
      "MemoryMax=6553M",
      "-p",
      "TasksMax=512",
      "--",
      "npm",
      "test",
    ]);
    expect(p.memoryMax).toBe("6553M");
  });

  it("runs a single-argument command line through sh", () => {
    const p = plan(["npm test && npm run build"], {
      platform: "linux",
      which: has,
      env: {},
      totalmem: 16 * GB,
    });
    expect(p.args.slice(-3)).toEqual([
      "/bin/sh",
      "-c",
      "npm test && npm run build",
    ]);
  });

  it("honours the env overrides", () => {
    const l = limits({
      env: { AOS_HEAVY_MEMORY_MAX: "4G", AOS_HEAVY_TASKS_MAX: "64" },
      totalmem: 16 * GB,
    });
    expect(l).toEqual({
      memoryMax: "4096M",
      memoryHigh: "3481M",
      tasksMax: 64,
    });
  });

  it("ignores junk overrides", () => {
    const l = limits({
      env: { AOS_HEAVY_MEMORY_MAX: "lots", AOS_HEAVY_TASKS_MAX: "-3" },
      totalmem: 10 * GB,
    });
    expect(l.tasksMax).toBe(512);
    expect(l.memoryMax).toBe("4096M");
  });

  it("runs as before on Linux without systemd-run", () => {
    expect(
      plan(["vite", "build"], { platform: "linux", which: () => null })
    ).toEqual({ cmd: "vite", args: ["build"], scoped: false });
  });

  it("runs as before on macOS and never looks for systemd-run", () => {
    let looked = false;
    const p = plan(["vite", "build"], {
      platform: "darwin",
      which: () => ((looked = true), "x"),
    });
    expect(p).toEqual({ cmd: "vite", args: ["build"], scoped: false });
    expect(looked).toBe(false);
  });
});

describe("heavy scope helpers", () => {
  it("parses sizes", () => {
    expect(parseSize("512M")).toBe(512 * 1024 ** 2);
    expect(parseSize("2g")).toBe(2 * GB);
    expect(parseSize("0")).toBeNull();
    expect(parseSize("x")).toBeNull();
  });

  it("spots a cap kill and words it", () => {
    expect(hitCap(137, null)).toBe(true);
    expect(hitCap(null, "SIGKILL")).toBe(true);
    expect(hitCap(1, null)).toBe(false);
    expect(capMessage(["vite", "build"], "6G")).toMatch(
      /^aos heavy: vite build hit the memory cap \(6G\) and was stopped/
    );
  });
});
