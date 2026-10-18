import fs from "fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudits } from "../session-audit/store";
import {
  codeHealthFile,
  latestCodeHealth,
  readCodeHealthIndex,
  recordCodeHealth,
  writePrepass,
} from "./store";
import type { Prepass } from "./summary";
import { tempDir } from "@/lib/test-temp";

let dir: string;
beforeEach(() => {
  dir = tempDir("code-health-");
  process.env.AGENTOS_AUDITS_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.AGENTOS_AUDITS_DIR;
});

const prepass = (id: string): Prepass => ({
  id,
  generatedAt: "2026-10-10T20:00:00.000Z",
  commit: "abc123",
  files: { code: 1, tests: 1, lines: 10 },
  collectors: {},
});

function complete(id: string) {
  writePrepass(prepass(id));
  fs.writeFileSync(
    codeHealthFile(id, ".md"),
    `---\nkind: code-health\naudited: 2026-10-10T20:00:00Z\n---\n# Code health ${id}\n`
  );
  fs.writeFileSync(
    codeHealthFile(id, ".json"),
    JSON.stringify({
      id,
      headline: "the big one",
      findings: [
        {
          key: "k",
          title: "Fix k",
          category: "dry",
          priority: "P1",
          effort: "S",
        },
      ],
    })
  );
}

describe("recordCodeHealth", () => {
  it("refuses an audit missing its pre-pass, report, frontmatter or findings", () => {
    const id = "2026-10-10-2000";
    expect(() => recordCodeHealth(id)).toThrow(/pre-pass/);
    writePrepass(prepass(id));
    expect(() => recordCodeHealth(id)).toThrow(/No report/);
    fs.writeFileSync(codeHealthFile(id, ".md"), "# no frontmatter\n");
    expect(() => recordCodeHealth(id)).toThrow(/frontmatter/);
    fs.writeFileSync(
      codeHealthFile(id, ".md"),
      "---\naudited: 2026-10-10\n---\n# ok\n"
    );
    fs.writeFileSync(
      codeHealthFile(id, ".json"),
      JSON.stringify({ findings: [{ title: "no key" }] })
    );
    expect(() => recordCodeHealth(id)).toThrow(/key and a title/);
    expect(readCodeHealthIndex()).toEqual([]);
  });

  it("indexes a complete audit once, and the Audits list shows it", () => {
    complete("2026-10-10-2000");
    recordCodeHealth("2026-10-10-2000");
    recordCodeHealth("2026-10-10-2000");
    expect(readCodeHealthIndex()).toEqual([
      {
        id: "2026-10-10-2000",
        kind: "code-health",
        at: "2026-10-10T20:00:00.000Z",
        commit: "abc123",
        headline: "the big one",
        findings: 1,
        top: ["Fix k"],
      },
    ]);
    expect(listAudits()).toEqual([
      expect.objectContaining({
        kind: "code-health",
        id: "2026-10-10-2000",
        title: "Code health 2026-10-10-2000",
        headline: "the big one",
        findings: 1,
      }),
    ]);
  });

  it("compares with the last recorded audit before this one, never itself", () => {
    complete("2026-10-09-2000");
    complete("2026-10-10-2000");
    recordCodeHealth("2026-10-09-2000");
    recordCodeHealth("2026-10-10-2000");
    expect(latestCodeHealth("2026-10-10-2000")?.id).toBe("2026-10-09-2000");
    expect(latestCodeHealth("2026-10-09-2000")).toBeNull();
    expect(latestCodeHealth()?.id).toBe("2026-10-10-2000");
  });

  it("rejects an id that could be a path", () => {
    expect(() => codeHealthFile("../x", ".md")).toThrow(/Bad audit id/);
  });
});
