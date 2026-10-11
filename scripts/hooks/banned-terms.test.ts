import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { GENERIC_TERMS, loadTerms, matcher, scanTree } from "./banned-terms";

const generic = GENERIC_TERMS[0];

function tempRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "banned-terms-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-q");
  return { repo, git };
}

describe("loadTerms", () => {
  it("is the generic list alone when the private file is absent", () => {
    const terms = loadTerms(path.join(os.tmpdir(), "no-such-banned-names"));
    expect(terms.map((t) => t.source)).toEqual(GENERIC_TERMS);
  });

  it("adds the private regexes, skipping blanks and comments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "banned-names-"));
    const file = path.join(dir, "banned-names");
    fs.writeFileSync(file, "# names\nacme[ -]?widgets\n\n  zorp  \n");
    try {
      const check = matcher(loadTerms(file));
      expect(check("We copied Acme-Widgets here")).toBe('"Acme-Widgets"');
      expect(check("ZORP")).toBe('"ZORP"');
      expect(check(`the ${generic.toUpperCase()} list`)).not.toBeNull();
      expect(check("nothing to see")).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanTree", () => {
  it("names the file and line of each hit, and a hit in a path", () => {
    const { repo, git } = tempRepo();
    try {
      fs.mkdirSync(path.join(repo, `${generic}-x`));
      fs.writeFileSync(path.join(repo, `${generic}-x`, "a.md"), "fine\n");
      fs.writeFileSync(path.join(repo, "b.ts"), `ok\n// a ${generic}\n`);
      fs.writeFileSync(path.join(repo, "c.bin"), `\0${generic}`);
      git("add", ".");
      expect(scanTree(repo, loadTerms("/nonexistent"))).toEqual([
        { file: "b.ts", line: 2, what: `"${generic}"` },
        { file: `${generic}-x/a.md`, line: 0, what: `"${generic}"` },
      ]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("the pre-commit check", () => {
  it("fails on a staged private name, and passes once it's gone", () => {
    const { repo, git } = tempRepo();
    const list = path.join(repo, "..", `${path.basename(repo)}-names`);
    fs.writeFileSync(list, "acme\n");
    const scan = () =>
      spawnSync(
        path.resolve("node_modules/.bin/tsx"),
        [path.resolve("scripts/hooks/banned-terms.ts")],
        {
          cwd: repo,
          encoding: "utf-8",
          env: { ...process.env, AGENTOS_BANNED_NAMES: list },
        }
      );
    try {
      fs.writeFileSync(path.join(repo, "x.md"), "ok\nlike Acme does\n");
      git("add", "x.md");
      const bad = scan();
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("x.md:2");
      fs.writeFileSync(path.join(repo, "x.md"), "ok\nlike others do\n");
      git("add", "x.md");
      expect(scan().status).toBe(0);
      fs.writeFileSync(path.join(repo, "acme-notes.md"), "clean\n");
      git("add", "acme-notes.md");
      const named = scan();
      expect(named.status).toBe(1);
      expect(named.stderr).toContain("acme-notes.md:0");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(list, { force: true });
    }
  });
});
