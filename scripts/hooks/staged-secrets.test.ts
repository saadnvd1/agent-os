import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { scanDiff } from "./staged-secrets";
import { tempDir } from "@/lib/test-temp";

// Fakes are built here, never written whole: a literal would be the very
// thing this scan (and the merge gate) refuses.
const fake = {
  github: ["gh", "p_", "a1B2".repeat(9)].join(""),
  anthropic: ["sk", "-ant-", "x9Y8".repeat(8)].join(""),
  aws: ["AK", "IA", "Q7".repeat(8)].join(""),
};

const diffOf = (file: string, start: number, lines: string[]) =>
  [
    `diff --git a/${file} b/${file}`,
    "index 0000000..1111111 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -0,0 +${start},${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join("\n");

describe("scanDiff", () => {
  it("names the file and line of each token-shaped string", () => {
    const diff = [
      diffOf("lib/a.ts", 10, ["const ok = 1;", `const t = "${fake.github}";`]),
      diffOf("docs/b.md", 3, [`key: ${fake.anthropic}`, "", fake.aws]),
    ].join("\n");
    expect(scanDiff(diff)).toEqual([
      { file: "lib/a.ts", line: 11, what: expect.stringMatching(/^ghp_/) },
      { file: "docs/b.md", line: 3, what: expect.stringMatching(/^sk-/) },
      { file: "docs/b.md", line: 5, what: expect.stringMatching(/^AKIA/) },
    ]);
  });

  it("flags an env-style assignment of a real-looking value, not a placeholder", () => {
    const diff = diffOf(".env.example", 1, [
      `API_TOKEN=${"q7R".repeat(6)}42`,
      "API_KEY=${API_KEY}",
      "SECRET_KEY=changeme",
    ]);
    expect(scanDiff(diff)).toEqual([
      { file: ".env.example", line: 1, what: "API_TOKEN = …" },
    ]);
  });

  it("passes code that builds a fake at runtime", () => {
    const diff = diffOf("lib/c.test.ts", 1, [
      'const t = ["gh", "p_", "a".repeat(36)].join("");',
    ]);
    expect(scanDiff(diff)).toEqual([]);
  });

  it("doesn't take an added line starting with ++ for a file header", () => {
    const diff = diffOf("lib/d.ts", 1, [`++ ${fake.github}`]);
    expect(scanDiff(diff)).toEqual([
      { file: "lib/d.ts", line: 1, what: expect.stringMatching(/^ghp_/) },
    ]);
  });

  it("fails the commit on a staged secret, and passes once it's gone", () => {
    const repo = tempDir("staged-secrets-");
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    const scan = () =>
      spawnSync(
        path.resolve("node_modules/.bin/tsx"),
        [path.resolve("scripts/hooks/staged-secrets.ts")],
        { cwd: repo, encoding: "utf-8" }
      );
    try {
      git("init", "-q");
      fs.writeFileSync(
        path.join(repo, "x.ts"),
        `const t = "${fake.github}";\n`
      );
      git("add", "x.ts");
      const bad = scan();
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("x.ts:1");
      expect(bad.stderr).toContain("at runtime");
      fs.writeFileSync(path.join(repo, "x.ts"), "const t = process.env.T;\n");
      git("add", "x.ts");
      expect(scan().status).toBe(0);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
