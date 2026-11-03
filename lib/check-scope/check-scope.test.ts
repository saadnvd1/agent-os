import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { checkScope } from "./index";
import { parseNameStatus } from "./changedFiles";
import { resolveSpecifier, specifiers } from "./importGraph";

function repo(files: Record<string, string>) {
  const dir = tempDir("aos-scope-");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const write = (name: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  for (const [name, text] of Object.entries(files)) write(name, text);
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-q", "-b", "task");
  return { dir, git, write };
}

const BASE = {
  "lib/a.ts": "export const a = 1;\n",
  "lib/b.ts": 'import { a } from "@/lib/a";\nexport const b = a;\n',
  "lib/c.ts": "export const c = 1;\n",
  "lib/index.ts": 'export * from "./b";\n',
  "lib/a.test.ts": 'import { a } from "./a";\n',
  "lib/b.test.ts": 'import { b } from "./b";\n',
  "lib/c.test.ts": 'import { c } from "./c";\n',
  "lib/viaIndex.test.ts": 'import { b } from "@/lib";\n',
  "lib/mocked.test.ts": 'vi.mock("@/lib/c", () => ({}));\n',
  "lib/dyn.test.ts": 'const m = await import("./c");\n',
  "bin/tool": "#!/bin/sh\n",
  "lib/tool.test.ts": 'run("bin/tool");\n',
  "docs/x.md": "# x\n",
  "scripts/docs-links.test.ts": "\n",
  "package.json": "{}\n",
  "lib/db/index.ts": "export const db = 1;\n",
  "lib/db/migrations/m1.ts": "export const up = 1;\n",
};

describe("import scanning", () => {
  it("reads from, dynamic import, require and vi.mock specifiers", () => {
    expect(
      specifiers(
        'import a from "./a"; export * from "./b"; await import("./c"); require("./d"); vi.mock("@/e"); import "./f";'
      )
    ).toEqual(["./a", "./b", "./c", "./d", "@/e", "./f"]);
  });

  it("resolves aliases, relative paths and index files, and skips packages", () => {
    const known = new Set(["lib/a.ts", "lib/x/index.ts", "lib/y.tsx"]);
    expect(resolveSpecifier("app/p.ts", "@/lib/a", known)).toBe("lib/a.ts");
    expect(resolveSpecifier("lib/q.ts", "./x", known)).toBe("lib/x/index.ts");
    expect(resolveSpecifier("lib/q/r.ts", "../y", known)).toBe("lib/y.tsx");
    expect(resolveSpecifier("lib/q.ts", "react", known)).toBeNull();
    expect(resolveSpecifier("lib/q.ts", "./nope", known)).toBeNull();
  });
});

describe("changed files", () => {
  it("reads renames with both paths and deletions", () => {
    expect(parseNameStatus("M\ta.ts\nD\tb.ts\nR100\told.ts\tnew.ts\n")).toEqual(
      [
        { path: "a.ts", deleted: false },
        { path: "b.ts", deleted: true },
        { path: "new.ts", from: "old.ts", deleted: false },
      ]
    );
  });
});

describe("checkScope", () => {
  it("runs the tests of a changed file's importers, transitively, and no others", () => {
    const r = repo(BASE);
    r.write("lib/a.ts", "export const a = 2;\n");
    const s = checkScope(r.dir);
    expect(s.full).toBe(false);
    expect(s.tests).toEqual([
      "lib/a.test.ts",
      "lib/b.test.ts",
      "lib/viaIndex.test.ts",
    ]);
    expect(s.lint).toEqual(["lib/a.ts"]);
    expect(s.format).toEqual(["lib/a.ts"]);
  });

  it("follows vi.mock and dynamic imports", () => {
    const r = repo(BASE);
    r.write("lib/c.ts", "export const c = 2;\n");
    expect(checkScope(r.dir).tests).toEqual([
      "lib/c.test.ts",
      "lib/dyn.test.ts",
      "lib/mocked.test.ts",
    ]);
  });

  it("counts committed, staged, unstaged and untracked changes", () => {
    const r = repo(BASE);
    r.write("lib/a.ts", "export const a = 2;\n");
    r.git("commit", "-qam", "a");
    r.write("lib/c.ts", "export const c = 2;\n");
    r.git("add", "-A");
    r.write("lib/new.test.ts", 'import { a } from "./a";\n');
    const s = checkScope(r.dir);
    expect(s.tests).toContain("lib/new.test.ts");
    expect(s.tests).toContain("lib/a.test.ts");
    expect(s.tests).toContain("lib/c.test.ts");
  });

  it("runs a changed test file itself", () => {
    const r = repo(BASE);
    r.write("lib/c.test.ts", "// edited\n");
    expect(checkScope(r.dir).tests).toEqual(["lib/c.test.ts"]);
  });

  it("finds tests that name a changed file by its path", () => {
    const r = repo(BASE);
    r.write("bin/tool", "#!/bin/sh\necho hi\n");
    expect(checkScope(r.dir).tests).toEqual(["lib/tool.test.ts"]);
  });

  it("counts both sides of a rename, and drops a deleted test", () => {
    const r = repo(BASE);
    r.git("mv", "lib/c.ts", "lib/c2.ts");
    r.git("rm", "-q", "lib/dyn.test.ts");
    const s = checkScope(r.dir);
    expect(s.tests).toEqual(["lib/c.test.ts", "lib/mocked.test.ts"]);
    expect(s.lint).toEqual(["lib/c2.ts"]);
  });

  it("sends a docs change to the link check and nothing else", () => {
    const r = repo(BASE);
    r.write("docs/x.md", "# y\n");
    expect(checkScope(r.dir).tests).toEqual(["scripts/docs-links.test.ts"]);
  });

  it("selects no tests when nothing testable changed", () => {
    const r = repo(BASE);
    r.write("notes.txt", "hi\n");
    const s = checkScope(r.dir);
    expect(s).toMatchObject({ full: false, tests: [], format: ["notes.txt"] });
  });

  it.each(["package.json", "lib/db/index.ts"])(
    "runs the full suite when %s changes",
    (file) => {
      const r = repo(BASE);
      r.write(
        file,
        file.endsWith(".json") ? '{"a":1}\n' : "export const db = 2;\n"
      );
      expect(checkScope(r.dir)).toMatchObject({ full: true, tests: [] });
      expect(checkScope(r.dir).reason).toContain(file);
    }
  );

  it("treats a migration as an ordinary file, not shared infrastructure", () => {
    const r = repo(BASE);
    r.write("lib/db/migrations/m1.ts", "export const up = 2;\n");
    expect(checkScope(r.dir).full).toBe(false);
  });

  it("runs the full suite when asked", () => {
    const r = repo(BASE);
    r.write("lib/a.ts", "export const a = 2;\n");
    expect(checkScope(r.dir, true)).toMatchObject({ full: true });
  });

  it("falls back to the full suite without a merge base", () => {
    const dir = tempDir("aos-scope-");
    execFileSync("git", ["init", "-q", "-b", "other"], { cwd: dir });
    expect(checkScope(dir)).toMatchObject({ full: true });
  });
});
