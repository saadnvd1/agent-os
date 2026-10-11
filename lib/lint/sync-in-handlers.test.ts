import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// The repo's own config, on code placed where a route handler would be.
async function restricted(code: string, filePath: string): Promise<number> {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax")
    .length;
}

describe("no synchronous child_process or fs in app/api", () => {
  const route = "app/api/example/route.ts";

  it("refuses *Sync imports and calls in a route", async () => {
    expect(
      await restricted(
        `import { execFileSync } from "child_process";\nexport const x = execFileSync;\n`,
        route
      )
    ).toBe(1);
    expect(
      await restricted(
        `import fs from "fs";\nexport const x = () => fs.readFileSync("a");\n`,
        route
      )
    ).toBe(1);
    expect(
      await restricted(
        `import * as cp from "node:child_process";\nexport const x = () => cp.spawnSync("a");\n`,
        route
      )
    ).toBe(1);
  });

  it("allows the async forms, and code outside app/api", async () => {
    expect(
      await restricted(
        `import { readFile } from "fs/promises";\nexport const x = () => readFile("a");\n`,
        route
      )
    ).toBe(0);
    expect(
      await restricted(
        `import { execFileSync } from "child_process";\nexport const x = execFileSync;\n`,
        "lib/example.ts"
      )
    ).toBe(0);
  });
});

describe("git only through lib/git-exec", () => {
  it("refuses git spawned anywhere else in server code", async () => {
    const spawns = [
      `import { execFile } from "child_process";\nexport const x = () => execFile("git", ["status"]);\n`,
      `import { spawn } from "child_process";\nexport const x = () => spawn("git", ["fetch"]);\n`,
      `import { run } from "./tasks/gh";\nexport const x = () => run("git", ["push"], ".");\n`,
      `import { exec } from "child_process";\nexport const x = () => exec("git status");\n`,
      `import { exec } from "child_process";\nexport const x = (b: string) => exec(\`git branch -D \${b}\`);\n`,
    ];
    for (const code of spawns) {
      expect(await restricted(code, "lib/example.ts")).toBe(1);
      expect(await restricted(code, "app/api/example/route.ts")).toBe(1);
    }
  });

  it("allows the helper itself, injected runners, tests and other commands", async () => {
    const spawn = `import { execFile } from "child_process";\nexport const x = () => execFile("git", ["status"]);\n`;
    expect(await restricted(spawn, "lib/git-exec.ts")).toBe(0);
    expect(await restricted(spawn, "lib/example.test.ts")).toBe(0);
    expect(
      await restricted(
        `export const x = (deps: { runner: (c: string, a: string[], d: string) => Promise<string> }) => deps.runner("git", ["fetch"], ".");\n`,
        "lib/example.ts"
      )
    ).toBe(0);
    expect(
      await restricted(
        `import { execFile } from "child_process";\nexport const x = () => execFile("gh", ["pr", "list"]);\n`,
        "lib/example.ts"
      )
    ).toBe(0);
  });
});
