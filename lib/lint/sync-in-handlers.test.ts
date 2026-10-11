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
