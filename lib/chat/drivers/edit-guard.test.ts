import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeOpenCodeGuard, OPENCODE_GUARD_PLUGIN } from "./opencode-plugin";
import { writePiEditGuard, PI_EDIT_GUARD_EXTENSION } from "./pi-edit-guard";
import { EDIT_GUARD_LIB } from "./edit-guard";
import { tempDir } from "@/lib/test-temp";

type P = Record<string, unknown>;
type Handler = (event: P, output?: P) => Promise<P | undefined>;
type Lib = {
  isFound: (text: string, old: string) => boolean;
  closestMatch: (
    text: string,
    old: string
  ) => { from: number; to: number; excerpt: string } | null;
  FailureLog: new () => { record(f: string, o: string): number };
  syntaxReport: (
    file: string,
    before: string | null,
    after: string,
    cwd?: string
  ) => string;
};

let dir: string;
let work: string;
let lib: Lib;
let piHandlers: Record<string, Handler>;
let hooks: Record<string, Handler>;

const load = async <T>(file: string) =>
  (await import(pathToFileURL(file).href)) as T;

beforeAll(async () => {
  dir = tempDir("edit-guard-");
  work = path.join(dir, "work");
  fs.mkdirSync(work);
  // The project being edited has no typescript of its own here: the server
  // hands over the one it runs on.
  process.env.AGENTOS_TYPESCRIPT = createRequire(import.meta.url).resolve(
    "typescript"
  );
  const folder = path.join(dir, "guard");
  const piFile = writePiEditGuard(folder);
  const ocFile = writeOpenCodeGuard(folder);
  lib = await load<Lib>(path.join(folder, "agentos-edit-guard-lib.mjs"));
  piHandlers = {};
  (await load<{ default: (pi: unknown) => void }>(piFile)).default({
    on: (e: string, h: Handler) => (piHandlers[e] = h),
  });
  hooks = (await (
    await load<{ AgentOSGuard: (c: P) => Promise<Record<string, Handler>> }>(
      ocFile
    )
  ).AgentOSGuard({ directory: work })) as Record<string, Handler>;
  process.chdir(work);
});

afterAll(() => {
  process.chdir(__dirname);
  delete process.env.AGENTOS_TYPESCRIPT;
  fs.rmSync(dir, { recursive: true, force: true });
});

const FILE = [
  "import { x } from './x';",
  "",
  "export async function run(items: string[]) {",
  "  const kws = items.map((i) => i.trim());",
  "  const jobs = kws.length;",
  "  return { kws, jobs };",
  "}",
  "",
].join("\n");

describe("isFound", () => {
  it("accepts what a harness's fuzzy matchers would", () => {
    expect(lib.isFound(FILE, "const jobs = kws.length;")).toBe(true);
    expect(lib.isFound(FILE, "const kws =   items.map((i) => i.trim());")).toBe(
      true
    );
    expect(lib.isFound(FILE, "    const jobs = kws.length;\n")).toBe(true);
    expect(
      lib.isFound(
        FILE,
        "export async function run(items: string[]) {\nwhatever\n}"
      )
    ).toBe(true);
  });

  it("refuses text that is not in the file", () => {
    expect(lib.isFound(FILE, "const jobs = loc.length;")).toBe(false);
  });
});

describe("closestMatch", () => {
  it("shows the file's current lines around the stale text, numbered", () => {
    const m = lib.closestMatch(
      FILE,
      "  const kws = items.map((i) => i.trim().toLowerCase());\n  const jobs = kws.length;"
    );
    expect(m?.excerpt).toContain(
      "4\t  const kws = items.map((i) => i.trim());"
    );
    expect(m?.excerpt).toContain("5\t  const jobs = kws.length;");
    expect(m?.from).toBeLessThanOrEqual(4);
  });

  it("says nothing when the file has nothing like it", () => {
    expect(lib.closestMatch(FILE, "zzz qqq unrelated")).toBeNull();
  });
});

describe("Pi edit guard", () => {
  const edit = (p: string, oldText: string, id = "c1") => ({
    toolName: "edit",
    toolCallId: id,
    input: { path: p, edits: [{ oldText, newText: "y" }] },
  });

  it("blocks a stale edit with the current text, and names a repeat", async () => {
    const file = path.join(work, "pi-stale.ts");
    fs.writeFileSync(file, FILE);
    const stale = "const kws = items.map((i) => i.toUpperCase());";
    const first = await piHandlers.tool_call(edit(file, stale));
    expect(first?.block).toBe(true);
    expect(String(first?.reason)).toContain("not found");
    expect(String(first?.reason)).toContain(
      "const kws = items.map((i) => i.trim());"
    );
    expect(String(first?.reason)).not.toContain("already failed");
    const again = await piHandlers.tool_call(edit(file, stale, "c2"));
    expect(String(again?.reason)).toContain("already failed");
  });

  it("lets an edit through that a harness could match", async () => {
    const file = path.join(work, "pi-ok.ts");
    fs.writeFileSync(file, FILE);
    expect(
      await piHandlers.tool_call(edit(file, "const jobs = kws.length;"))
    ).toBeUndefined();
  });

  it("does not block when the file can't be read", async () => {
    expect(
      await piHandlers.tool_call(edit(path.join(work, "missing.ts"), "a"))
    ).toBeUndefined();
  });

  it("adds new syntax errors and duplicate declarations to the result", async () => {
    const file = path.join(work, "pi-dup.ts");
    fs.writeFileSync(file, FILE);
    await piHandlers.tool_call(edit(file, "const jobs = kws.length;", "w1"));
    fs.writeFileSync(
      file,
      FILE.replace(
        "const jobs = kws.length;",
        "const kws = [];\n  const jobs = kws.length;\n  const jobs = 2;\n  : [];"
      )
    );
    const out = await piHandlers.tool_result({
      toolName: "edit",
      toolCallId: "w1",
      input: { path: file },
      isError: false,
      content: [{ type: "text", text: "Successfully edited" }],
    });
    const text = JSON.stringify(out?.content);
    expect(text).toContain("Successfully edited");
    expect(text).toContain("kws is declared more than once");
    expect(text).toContain("jobs is declared more than once");
    expect(text).toMatch(/\d+:\d+ /);
  });

  it("stays quiet about a clean edit", async () => {
    const file = path.join(work, "pi-clean.ts");
    fs.writeFileSync(file, FILE);
    await piHandlers.tool_call(edit(file, "const jobs = kws.length;", "w2"));
    fs.writeFileSync(file, FILE.replace("kws.length", "kws.length + 1"));
    expect(
      await piHandlers.tool_result({
        toolName: "edit",
        toolCallId: "w2",
        input: { path: file },
        isError: false,
        content: [],
      })
    ).toBeUndefined();
  });

  it("appends the file's text to a failure Pi itself reports", async () => {
    const file = path.join(work, "pi-failed.ts");
    fs.writeFileSync(file, FILE);
    // Passes the check (trimmed lines match) but Pi's own matcher missed it.
    const old = "const jobs = kws.length;";
    await piHandlers.tool_call(edit(file, old, "f1"));
    const out = await piHandlers.tool_result({
      toolName: "edit",
      toolCallId: "f1",
      input: { path: file, edits: [{ oldText: old, newText: "z" }] },
      isError: true,
      content: [{ type: "text", text: "Could not find the exact text in x" }],
    });
    const text = JSON.stringify(out?.content);
    expect(text).toContain("closest match");
    expect(text).toContain("Read");
  });
});

describe("syntaxReport", () => {
  it("reports only what is new", () => {
    const broken = FILE + "const a = ;\n";
    expect(
      lib.syntaxReport("a.ts", broken, broken + "const b = 1;\n", work)
    ).toBe("");
    expect(lib.syntaxReport("a.ts", FILE, broken, work)).toContain("a.ts");
  });

  it("does not call shadowing in a nested block a duplicate", () => {
    const text =
      "const a = 1;\nfunction f() {\n  const a = 2;\n  return a;\n}\n";
    expect(lib.syntaxReport("a.ts", null, text, work)).toBe("");
  });

  it("counts a var and a const of one name, and a redeclared class", () => {
    const report = lib.syntaxReport(
      "a.ts",
      null,
      "var q = 1;\nconst q = 2;\nclass K {}\nlet K = 1;\n",
      work
    );
    expect(report).toContain("q is declared more than once");
    expect(report).toContain("K is declared more than once");
  });

  it("leaves overloads alone", () => {
    const text =
      "function f(a: string): void;\nfunction f(a: number): void;\nfunction f(a: any) {}\n";
    expect(lib.syntaxReport("a.ts", null, text, work)).toBe("");
  });

  it("skips files that are not source and works for tsx", () => {
    expect(lib.syntaxReport("a.md", null, "const a = ;", work)).toBe("");
    expect(
      lib.syntaxReport("a.tsx", null, "const a = <div>{</div>;", work)
    ).toContain("a.tsx");
  });

  it("is silent when TypeScript can't be loaded", () => {
    const keep = process.env.AGENTOS_TYPESCRIPT;
    process.env.AGENTOS_TYPESCRIPT = path.join(dir, "nowhere");
    try {
      expect(lib.syntaxReport("a.ts", null, "const a = ;", work)).toBe("");
    } finally {
      process.env.AGENTOS_TYPESCRIPT = keep;
    }
  });

  it("parses a large file quickly", () => {
    const big = Array.from(
      { length: 2000 },
      (_, i) => `export const v${i} = ${i};`
    ).join("\n");
    const t = Date.now();
    lib.syntaxReport("big.ts", big, big + "\nconst z = ;", work);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("OpenCode guard plugin", () => {
  const args = (filePath: string, oldString: string) => ({
    filePath,
    oldString,
    newString: "n",
  });

  it("fails a stale edit with the current text", async () => {
    const file = path.join(work, "oc-stale.ts");
    fs.writeFileSync(file, FILE);
    await expect(
      hooks["tool.execute.before"](
        { tool: "edit", callID: "a" },
        { args: args(file, "const jobs = nope.length;") }
      )
    ).rejects.toThrow(/const jobs = kws\.length;/);
  });

  it("names an edit its own tool failed once and is sent again unchanged", async () => {
    const file = path.join(work, "oc-repeat.ts");
    fs.writeFileSync(file, FILE);
    const a = args(file, "const jobs = kws.length;");
    await hooks["tool.execute.before"](
      { tool: "edit", callID: "r1" },
      { args: a }
    );
    // No after: OpenCode's matcher failed it.
    await expect(
      hooks["tool.execute.before"]({ tool: "edit", callID: "r2" }, { args: a })
    ).rejects.toThrow(/already failed/);
  });

  it("lets a finished edit repeat, and a changed file through", async () => {
    const file = path.join(work, "oc-done.ts");
    fs.writeFileSync(file, FILE);
    const a = args(file, "const jobs = kws.length;");
    await hooks["tool.execute.before"](
      { tool: "edit", callID: "d1" },
      { args: a }
    );
    await hooks["tool.execute.after"](
      { tool: "edit", callID: "d1", args: a },
      { output: "ok" }
    );
    await expect(
      hooks["tool.execute.before"]({ tool: "edit", callID: "d2" }, { args: a })
    ).resolves.toBeUndefined();
  });

  it("appends syntax problems to the result", async () => {
    const file = path.join(work, "oc-syntax.ts");
    fs.writeFileSync(file, FILE);
    const a = args(file, "const jobs = kws.length;");
    await hooks["tool.execute.before"](
      { tool: "edit", callID: "s1" },
      { args: a }
    );
    fs.writeFileSync(file, FILE + "const kws = 3;\nconst kws = 4;\n");
    const output = { output: "Edit applied" };
    await hooks["tool.execute.after"](
      { tool: "edit", callID: "s1", args: a },
      output
    );
    expect(output.output).toContain("Edit applied");
    expect(output.output).toContain("kws is declared more than once");
  });

  it("ignores other tools", async () => {
    await expect(
      hooks["tool.execute.before"]({ tool: "bash", callID: "b" }, { args: {} })
    ).resolves.toBeUndefined();
  });
});

describe("sources", () => {
  it("hold no backticks or template holes that would break the string", () => {
    for (const s of [
      EDIT_GUARD_LIB,
      PI_EDIT_GUARD_EXTENSION,
      OPENCODE_GUARD_PLUGIN,
    ])
      expect(s).not.toMatch(/\$\{/);
  });
});
