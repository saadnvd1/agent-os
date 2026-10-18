import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { renderDiskReport, writeDiskReport } from "./report";
import type { SweepSummary } from "./types";

const summary = (): SweepSummary => ({
  removed: [
    { path: "/w/a", kind: "settled", why: "clean", bytes: 2 * 1024 ** 3 },
  ],
  pending: [
    { path: "app_aos_0123456789ab", kind: "database", why: "dead", bytes: 4e6 },
    { path: "/w/repo-quick-x", kind: "test-leak", why: "t", bytes: 1e6 },
  ],
  skipped: [
    { path: "/w/b", kind: "settled", reason: "it has uncommitted changes (1)" },
    { path: "/w/c", kind: "orphan", reason: "touched less than 7 days ago" },
  ],
  freedBytes: 2 * 1024 ** 3,
  armed: false,
});

describe("disk report", () => {
  it("lists what would go by kind, with sizes, and what stays", () => {
    const md = renderDiskReport(summary(), new Date("2026-10-18T12:00:00Z"));
    expect(md).toContain("Would remove 3 items");
    expect(md).toContain("Full clean-up is off");
    expect(md).toContain("## Task databases: 1");
    expect(md).toContain("## Throwaway repositories left by tests: 1");
    expect(md).toContain("`app_aos_0123456789ab`");
    expect(md).toContain("`/w/b` · it has uncommitted changes (1)");
    expect(md).not.toContain("`/w/c`");
  });

  it("a second report the same day gets a suffix, never overwrites", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-report-"));
    const at = new Date(2026, 9, 18, 12);
    const one = writeDiskReport(summary(), at, dir);
    const two = writeDiskReport(summary(), at, dir);
    expect([path.basename(one), path.basename(two)]).toEqual([
      "2026-10-18.md",
      "2026-10-18-2.md",
    ]);
  });
});
