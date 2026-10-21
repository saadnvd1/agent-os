import fs from "fs";
import http from "http";
import path from "path";
import { spawnSync } from "child_process";
import type { AddressInfo } from "net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ChatAccess, ChatItem } from "../events";
import { piDriver } from "./pi";
import { tempDir } from "@/lib/test-temp";

// The real Pi CLI against a stub OpenAI-compatible server, so no model or
// service is called. Pi isn't a dependency of this repo: where it isn't
// installed (CI) the units in pi-text-tools, turn-outcome and pi-mapper
// cover the same logic.
const piInstalled = spawnSync("pi", ["--version"]).status === 0;

type Body = { messages: { role: string; content?: unknown }[] };
type Reply =
  | { content: string; finish: string }
  | { call: { name: string; args: unknown } };

const HERMES = (command: string) =>
  `Let me run it.\n<tool_call>\n${JSON.stringify({ name: "bash", arguments: { command } })}\n</tool_call>`;

let server: http.Server;
let dir: string;
let script: (body: Body, n: number) => Reply;
let requests: Body[] = [];

const chunk = (delta: object, finish: string | null) =>
  `data: ${JSON.stringify({
    id: "stub",
    object: "chat.completion.chunk",
    created: 1,
    model: "qwen-stub",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;

beforeAll(async () => {
  dir = tempDir("pi-local-");
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as Body;
      requests.push(body);
      const reply = script(body, requests.length);
      res.writeHead(200, { "content-type": "text/event-stream" });
      if ("call" in reply)
        res.write(
          chunk(
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: {
                    name: reply.call.name,
                    arguments: JSON.stringify(reply.call.args),
                  },
                },
              ],
            },
            null
          ) + chunk({}, "tool_calls")
        );
      else
        res.write(
          chunk({ role: "assistant", content: reply.content }, null) +
            chunk({}, reply.finish)
        );
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  fs.mkdirSync(path.join(dir, "agent"));
  fs.writeFileSync(
    path.join(dir, "agent", "models.json"),
    JSON.stringify({
      providers: {
        stub: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: "openai-completions",
          apiKey: ["stub", "key", "x".repeat(8)].join("-"),
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
          models: [{ id: "qwen-stub", name: "Qwen stub", maxTokens: 512 }],
        },
      },
    })
  );
  fs.mkdirSync(path.join(dir, "work"));
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  requests = [];
  vi.restoreAllMocks();
});

const toolResult = (b: Body) =>
  b.messages.some((m) => m.role === "tool" || m.role === "toolResult");

async function turn(
  access: ChatAccess,
  scenario: typeof script,
  onItem?: (item: ChatItem, respond: (id: string) => void) => void
) {
  script = scenario;
  const conv = piDriver.start({
    cwd: path.join(dir, "work"),
    model: "stub/qwen-stub",
    access,
    env: { PI_CODING_AGENT_DIR: path.join(dir, "agent") },
  });
  const items = new Map<string, ChatItem>();
  try {
    conv.send("check it", undefined);
    for await (const e of conv.events) {
      if (e.type !== "item") continue;
      items.set(e.item.id, e.item);
      onItem?.(e.item, (id) => conv.respond(id, { decision: "allow" }));
      if (e.item.kind === "turn_end") break;
    }
  } finally {
    conv.close();
  }
  const all = [...items.values()];
  return {
    all,
    tools: all.filter((i) => i.kind === "tool"),
    end: all.find((i) => i.kind === "turn_end"),
  };
}

const finish: Reply = { content: "Finished.", finish: "stop" };

describe.skipIf(!piInstalled)("a local model through Pi", () => {
  it("runs a structured tool call and returns the result to the model", async () => {
    const r = await turn("full", (b) =>
      toolResult(b)
        ? finish
        : { call: { name: "bash", args: { command: "echo aos-stub-ok" } } }
    );
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0]).toMatchObject({ status: "done" });
    expect(JSON.stringify(r.tools[0])).toContain("aos-stub-ok");
    expect(JSON.stringify(requests.at(-1))).toContain("aos-stub-ok");
    expect(requests[0]).toHaveProperty("tools");
    expect(r.end).toMatchObject({ finishReason: "stop" });
    expect(r.end?.kind === "turn_end" && r.end.ended).toBeUndefined();
  }, 60_000);

  it("runs a Qwen-style text tool call the same way", async () => {
    const r = await turn("full", (b) =>
      toolResult(b)
        ? finish
        : { content: HERMES("echo aos-stub-ok"), finish: "stop" }
    );
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0]).toMatchObject({ status: "done", name: "Bash" });
    expect(JSON.stringify(requests.at(-1))).toContain("aos-stub-ok");
    expect(r.end?.kind === "turn_end" && r.end.ended).toBeUndefined();
    const said = r.all.filter((i) => i.kind === "assistant");
    expect(JSON.stringify(said)).not.toContain("tool_call");
  }, 60_000);

  it("asks before running a text tool call when access is 'ask'", async () => {
    let asked = "";
    const r = await turn(
      "ask",
      (b) =>
        toolResult(b)
          ? finish
          : { content: HERMES("echo aos-stub-ok"), finish: "stop" },
      (item, respond) => {
        if (item.kind === "approval" && item.status === "pending") {
          asked = item.toolName;
          respond(item.id);
        }
      }
    );
    expect(asked).toBe("Bash");
    expect(r.tools[0]).toMatchObject({ status: "done" });
  }, 60_000);

  it("shows a notice and logs when the reply announces an action", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await turn("full", () => ({
      content: "First, let me run typecheck.",
      finish: "stop",
    }));
    expect(r.tools).toHaveLength(0);
    expect(r.end).toMatchObject({
      finishReason: "stop",
      ended: { reason: "no_tool_call" },
    });
    const line = JSON.parse(warn.mock.calls[0][1] as string);
    expect(line).toMatchObject({
      driver: "pi",
      provider: "stub",
      model: "qwen-stub",
      finishReason: "stop",
    });
  }, 60_000);

  it("shows a notice and logs when the model hits its output limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await turn("full", () => ({
      content: "The plan is to",
      finish: "length",
    }));
    expect(r.end).toMatchObject({
      finishReason: "length",
      ended: { reason: "length" },
    });
    expect(warn).toHaveBeenCalledOnce();
  }, 60_000);
});
