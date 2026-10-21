import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXTENSION } from "./pi-approvals";
import { TEXT_TOOLS_EXTENSION } from "./pi-text-tools";
import { tempDir } from "@/lib/test-temp";

type P = Record<string, unknown>;
type Handler = (event: P, ctx: P) => Promise<P | undefined>;
type Ext = { default: (pi: unknown) => void };

const TOOLS = [
  {
    name: "bash",
    parameters: { properties: { command: { type: "string" } } },
  },
  {
    name: "read",
    parameters: {
      properties: { path: { type: "string" }, limit: { type: "number" } },
    },
  },
];

let dir: string;
let messageEnd: Handler;
let toolCall: Handler;

async function load(name: string, source: string, pi: P): Promise<void> {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source);
  const ext = (await import(pathToFileURL(file).href)) as Ext;
  ext.default(pi);
}

beforeAll(async () => {
  dir = tempDir("pi-text-tools-");
  const pi = {
    on: (event: string, h: Handler) => {
      if (event === "message_end") messageEnd = h;
      if (event === "tool_call") toolCall = h;
    },
    getActiveTools: () => TOOLS.map((t) => t.name),
    getAllTools: () => TOOLS,
  };
  await load("text-tools.mjs", TEXT_TOOLS_EXTENSION, pi);
  await load("approvals.mjs", EXTENSION, pi);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const reply = (text: string, stopReason = "stop", extra: P[] = []) => ({
  role: "assistant",
  stopReason,
  content: [{ type: "text", text }, ...extra],
});

async function convert(text: string, stopReason = "stop", extra: P[] = []) {
  const out = await messageEnd({ message: reply(text, stopReason, extra) }, {});
  return out?.message as
    (ReturnType<typeof reply> & { aosRecovered?: P }) | undefined;
}

const calls = (m: { content: P[] }) =>
  m.content.filter((c) => c.type === "toolCall");

describe("Pi text tool calls", () => {
  it("turns a Hermes/Qwen JSON block into a tool call", async () => {
    const m = await convert(
      'First, let me run it.\n<tool_call>\n{"name": "bash", "arguments": {"command": "npm run typecheck"}}\n</tool_call>'
    );
    expect(m?.stopReason).toBe("toolUse");
    expect(m?.content[0]).toEqual({
      type: "text",
      text: "First, let me run it.",
    });
    const [call] = calls(m as never);
    expect(call).toMatchObject({
      name: "bash",
      arguments: { command: "npm run typecheck" },
    });
    expect(String(call.id)).toMatch(/^aostext_/);
    expect(m?.aosRecovered).toEqual({
      index: 0,
      text: "First, let me run it.",
    });
  });

  it("reads arguments given as a JSON string, and 'parameters'", async () => {
    const a = await convert(
      '<tool_call>{"name":"bash","arguments":"{\\"command\\":\\"ls\\"}"}</tool_call>'
    );
    expect(calls(a as never)[0].arguments).toEqual({ command: "ls" });
    const b = await convert(
      '<tool_call>{"name":"bash","parameters":{"command":"pwd"}}</tool_call>'
    );
    expect(calls(b as never)[0].arguments).toEqual({ command: "pwd" });
    expect(b?.content.some((c) => c.type === "text")).toBe(false);
  });

  it("reads Qwen3-Coder XML, with non-string parameters from the schema", async () => {
    const m = await convert(
      "Reading.\n<tool_call>\n<function=read>\n<parameter=path>\nsrc/a.ts\n</parameter>\n<parameter=limit>\n20\n</parameter>\n</function>\n</tool_call>"
    );
    expect(calls(m as never)[0]).toMatchObject({
      name: "read",
      arguments: { path: "src/a.ts", limit: 20 },
    });
  });

  it("takes several blocks, and a last one missing its closing tag", async () => {
    const m = await convert(
      '<tool_call>{"name":"bash","arguments":{"command":"a"}}</tool_call>\n<tool_call>{"name":"bash","arguments":{"command":"b"}}'
    );
    expect(calls(m as never).map((c) => (c.arguments as P).command)).toEqual([
      "a",
      "b",
    ]);
  });

  it("leaves a reply alone that merely mentions the markup", async () => {
    const quoted = [
      'The format is <tool_call>{"name":"bash","arguments":{}}</tool_call> and then I continue talking.',
      '```\n<tool_call>{"name":"bash","arguments":{"command":"x"}}</tool_call>\n```',
    ];
    for (const text of quoted) expect(await convert(text)).toBeUndefined();
  });

  it("leaves unknown tools, bad JSON, length cuts and real calls alone", async () => {
    const unknown =
      '<tool_call>{"name":"rm_rf","arguments":{"path":"/"}}</tool_call>';
    expect(await convert(unknown)).toBeUndefined();
    expect(await convert("<tool_call>{nope</tool_call>")).toBeUndefined();
    expect(
      await convert(
        '<tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>',
        "length"
      )
    ).toBeUndefined();
    expect(
      await convert(
        '<tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>',
        "stop",
        [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }]
      )
    ).toBeUndefined();
  });

  it("makes calls that still ask for approval, never around it", async () => {
    const m = await convert(
      '<tool_call>{"name":"bash","arguments":{"command":"rm x"}}</tool_call>'
    );
    const [call] = calls(m as never);
    const accessFile = path.join(dir, "access");
    process.env.AGENTOS_PI_ACCESS_FILE = accessFile;
    const run = async (access: string) => {
      fs.writeFileSync(accessFile, access);
      const asked: string[] = [];
      const result = await toolCall(
        { toolName: call.name, input: call.arguments, toolCallId: call.id },
        {
          ui: {
            confirm: async (title: string) => {
              asked.push(title);
              return false;
            },
          },
        }
      );
      return { asked, blocked: !!result?.block };
    };
    expect(await run("ask")).toEqual({
      asked: [`agentos:${call.id}`],
      blocked: true,
    });
    expect(await run("edits")).toMatchObject({ blocked: true });
    expect(await run("full")).toEqual({ asked: [], blocked: false });
  });
});
