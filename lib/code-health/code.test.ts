import { describe, expect, it } from "vitest";
import {
  duplicateBlocks,
  largestFiles,
  largestFunctions,
  routeGuards,
  routePath,
  shellCalls,
  sqlConcat,
} from "./code";
import type { SourceFile } from "./source";

const f = (path: string, text: string): SourceFile => ({ path, text });
const lines = (n: number, make: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => make(i)).join("\n");

describe("largestFiles and largestFunctions", () => {
  it("ranks source files by lines and leaves tests and built output out", () => {
    const files = [
      f(
        "lib/a.ts",
        lines(30, (i) => `const a${i} = ${i};`)
      ),
      f(
        "lib/b.ts",
        lines(10, (i) => `const b${i} = ${i};`)
      ),
      f(
        "lib/a.test.ts",
        lines(99, (i) => `const t${i} = ${i};`)
      ),
      f(
        ".next/server/x.js",
        lines(99, (i) => `x${i}`)
      ),
    ];
    expect(largestFiles(files)).toEqual([
      { path: "lib/a.ts", lines: 30 },
      { path: "lib/b.ts", lines: 10 },
    ]);
  });

  it("names each long function, counts all of them and keeps the top few", () => {
    const body = lines(8, (i) => `  const x${i} = ${i};`);
    const text = [
      `export function named() {\n${body}\n}`,
      `const arrow = () => {\n${body}\n};`,
      `class K {\n  method() {\n${body}\n  }\n}`,
      `function short() { return 1; }`,
    ].join("\n");
    const result = largestFunctions([f("lib/x.ts", text)], {
      min: 5,
      limit: 2,
    });
    expect(result.count).toBe(3);
    expect(result.top).toHaveLength(2);
    expect(result.top.map((t) => t.name).sort()).toEqual(["arrow", "named"]);
    expect(result.top[0]).toMatchObject({ where: "lib/x.ts:1", lines: 10 });
  });
});

describe("duplicateBlocks", () => {
  const block = lines(12, (i) => `total += compute(item${i}, ${i});`);

  it("finds the same lines in two files, extended to the whole copy", () => {
    const result = duplicateBlocks(
      [
        f("lib/one.ts", `// one\n${block}\nreturn total;`),
        f("lib/two.ts", `import x from "y";\n\nlet other = 1;\n${block}`),
      ],
      { window: 5 }
    );
    expect(result.blocks).toEqual([
      expect.objectContaining({
        lines: 12,
        a: "lib/one.ts:2-13",
        b: "lib/two.ts:4-15",
      }),
    ]);
    expect(result.duplicatedLines).toBe(24);
  });

  it("ignores whitespace, but not a changed line", () => {
    const indented = block.replace(/^/gm, "    ");
    const changed = block.replace("item6", "other6");
    const same = duplicateBlocks(
      [f("lib/a.ts", block), f("lib/b.ts", indented)],
      { window: 5 }
    );
    expect(same.blocks[0]?.lines).toBe(12);
    const split = duplicateBlocks(
      [f("lib/a.ts", block), f("lib/b.ts", changed)],
      { window: 5 }
    );
    expect(split.blocks.map((b) => b.lines).sort()).toEqual([5, 6]);
  });

  it("doesn't call a run of repeated lines a copy of itself, or count tests", () => {
    const repeated = lines(20, () => "doSomething();");
    expect(
      duplicateBlocks([f("lib/a.ts", repeated)], { window: 5 }).blocks.every(
        (b) => b.lines < 20
      )
    ).toBe(true);
    expect(
      duplicateBlocks([f("lib/a.test.ts", block), f("lib/b.test.ts", block)], {
        window: 5,
      }).blocks
    ).toEqual([]);
  });
});

describe("shellCalls", () => {
  const cp = `import { exec, execSync, spawn } from "child_process";\n`;

  it("flags exec with a built string, spawn with shell: true and sh -c with a variable", () => {
    const { risky, literal } = shellCalls([
      f(
        "lib/run.ts",
        cp +
          [
            "exec(`git log ${branch}`);",
            'execSync("ls -la");',
            'execSync("rm " + file);',
            "exec(command);",
            'spawn("git", ["status"]);',
            "spawn(cmd, args, { shell: true });",
            'spawn("sh", ["-c", script]);',
            'spawn("bash", ["-lc", "echo hi"]);',
          ].join("\n")
      ),
    ]);
    expect(risky.map((r) => [r.where, r.call, r.shape])).toEqual([
      ["lib/run.ts:2", "exec", "interpolated"],
      ["lib/run.ts:4", "execSync", "concatenated"],
      ["lib/run.ts:5", "exec", "variable"],
      ["lib/run.ts:7", "spawn", "shell-option"],
      ["lib/run.ts:8", "spawn sh -c", "variable"],
    ]);
    expect(risky[0].text).toBe("git log ${branch}");
    expect(literal).toBe(2);
  });

  it("only reads files that use child_process", () => {
    expect(shellCalls([f("lib/db.ts", "db.exec(`x ${y}`);")]).risky).toEqual(
      []
    );
  });
});

describe("sqlConcat", () => {
  it("flags SQL built with ${} or +, and marks placeholder lists", () => {
    const text = [
      'db.prepare("SELECT * FROM t WHERE id = ?").get(id);',
      'db.prepare(`SELECT * FROM t WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids);',
      "db.prepare(`UPDATE t SET ${column} = ? WHERE id = ?`).run(v, id);",
      'db.exec("DELETE FROM t WHERE name = \'" + name + "\'");',
      "logger.get(`not ${sql}`);",
      "db.prepare(sql).run();",
    ].join("\n");
    const out = sqlConcat([f("lib/q.ts", text)]);
    expect(out.map((o) => [o.where, o.shape, o.placeholdersOnly])).toEqual([
      ["lib/q.ts:2", "interpolated", true],
      ["lib/q.ts:3", "interpolated", false],
      ["lib/q.ts:4", "concatenated", false],
    ]);
    expect(out[1].text).toBe("UPDATE t SET ${column} = ? WHERE id = ?");
  });
});

describe("routeGuards", () => {
  const isPublic = (url: string) => url === "/api/pair/claim";

  it("maps route files to URLs, dropping route groups", () => {
    expect(routePath("app/api/sessions/[id]/route.ts")).toBe(
      "/api/sessions/[id]"
    );
    expect(routePath("app/(admin)/api/x/route.ts")).toBe("/api/x");
  });

  it("sorts routes into public, guarded and writes with no extra guard", () => {
    const result = routeGuards(
      [
        f("app/api/pair/claim/route.ts", "export async function POST() {}"),
        f(
          "app/api/devices/[id]/route.ts",
          'import { requireLocalTrust } from "@/lib/security/route-guard";\nexport async function DELETE() {}'
        ),
        f(
          "app/api/sessions/[id]/route.ts",
          "export async function GET() {}\nexport const PATCH = async () => {};"
        ),
        f("app/api/sessions/route.ts", "export async function GET() {}"),
        f("app/api/helpers.ts", "export function POST() {}"),
      ],
      isPublic
    );
    expect(result.total).toBe(4);
    expect(result.public.map((r) => r.path)).toEqual(["/api/pair/claim"]);
    expect(result.guarded).toEqual([
      {
        path: "/api/devices/[id]",
        methods: ["DELETE"],
        guards: ["requireLocalTrust"],
      },
    ]);
    expect(result.unguardedWrites).toEqual({
      sessions: ["PATCH /api/sessions/[id]"],
    });
  });
});
