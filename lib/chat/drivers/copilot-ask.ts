import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ChatQuestion } from "../events";
import {
  answersInOrder,
  type ApprovalOutcome,
  type PendingApprovals,
} from "./pending-approvals";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const ASK_SERVER = "agentos";
export const ASK_TOOL = "ask_user";
const MAX_BODY = 64 * 1024;

// Copilot CLI doesn't offer its own ask_user over ACP, so each conversation
// serves one: a question the agent asks becomes the chat's question card.
export const askInput = {
  question: z.string().min(1).describe("The question to show the user"),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        description: z.string().optional(),
      })
    )
    .optional()
    .describe("Choices to offer; leave out for a free-text question"),
  multiSelect: z
    .boolean()
    .optional()
    .describe("Let the user pick more than one option"),
  allowFreeText: z
    .boolean()
    .optional()
    .describe("The user can always type their own answer too"),
  header: z.string().optional().describe("A short label for the question"),
};

type AskArgs = {
  question: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
  header?: string;
};

export function askUserQuestion(a: AskArgs): ChatQuestion {
  const seen = new Set<string>();
  const options = (a.options ?? []).flatMap((o) => {
    const label = o.label.trim();
    if (!label || seen.has(label)) return [];
    seen.add(label);
    return [{ label, description: o.description?.trim() ?? "" }];
  });
  return {
    question: a.question.trim(),
    header: a.header?.trim() ?? "",
    multiSelect: !!a.multiSelect && options.length > 0,
    options,
  };
}

const text = (t: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError } : {}),
});

export function askUserResult(
  q: ChatQuestion,
  o: ApprovalOutcome
): CallToolResult {
  if (o.decision === "answer") {
    const [list] = answersInOrder([q], o.answers);
    return text(
      JSON.stringify(
        q.multiSelect ? { answers: list } : { answer: list[0] ?? "" }
      )
    );
  }
  if (o.decision === "expired")
    return text("The question was cancelled before the user answered.", true);
  return text("The user skipped this question without answering.");
}

// Whether a Copilot tool call (a tool_call update or a permission request) is
// our ask_user. Its title carries the server and tool name; the input is the
// fallback for a title that doesn't.
export function isAskUserCall(call: P): boolean {
  const raw = (call.rawInput ?? {}) as P;
  const title = str(call.title);
  return (
    title.includes(ASK_TOOL) ||
    (title.includes(ASK_SERVER) && typeof raw.question === "string")
  );
}

// One private MCP server per conversation: loopback only, behind a secret
// path, so nothing else can reach it or answer its cards.
export class CopilotAskServer {
  private http?: http.Server;
  private secret = crypto.randomBytes(32).toString("hex");
  private next = 0;
  private live = new Set<{ close(): Promise<void> }>();

  constructor(private pending: PendingApprovals) {}

  private build(): McpServer {
    const server = new McpServer({ name: ASK_SERVER, version: "1.0.0" });
    server.registerTool(
      ASK_TOOL,
      {
        description:
          "Ask the user a question and wait for the answer. Use it when you need a decision or missing information instead of asking in plain text. Offer options for a choice (multiSelect to allow several); with no options the user types an answer. Blocks until they answer.",
        inputSchema: askInput,
      },
      async (args) => {
        const q = askUserQuestion(args);
        const o = await this.pending.ask({
          id: `approval-ask-${++this.next}`,
          toolName: "AskUserQuestion",
          title: "Questions",
          input: { questions: [q] },
          questions: [q],
          canAlways: false,
        });
        return askUserResult(q, o);
      }
    );
    return server;
  }

  private allowed(req: http.IncomingMessage): number {
    if (req.headers.origin) return 403;
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (host !== "127.0.0.1" && host !== "localhost") return 403;
    const want = Buffer.from(`/mcp/${this.secret}`);
    const got = Buffer.from((req.url ?? "").split("?")[0]);
    return got.length === want.length && crypto.timingSafeEqual(got, want)
      ? 200
      : 404;
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const status = this.allowed(req);
    if (status !== 200) {
      res.writeHead(status).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(c as Buffer);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400).end();
      return;
    }
    const server = this.build();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const handle = {
      close: async () => {
        await transport.close();
        await server.close();
      },
    };
    this.live.add(handle);
    res.on("close", () => {
      this.live.delete(handle);
      void handle.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  // The `mcpServers` entry to give ACP session/new and session/load.
  async start(): Promise<P> {
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    this.http = server;
    const { port } = server.address() as AddressInfo;
    return {
      type: "http",
      name: ASK_SERVER,
      url: `http://127.0.0.1:${port}/mcp/${this.secret}`,
      headers: [],
    };
  }

  // Cancels any question still waiting (its call returns a cancellation)
  // and stops listening.
  close(): void {
    this.pending.expireAll();
    const server = this.http;
    this.http = undefined;
    server?.close();
    server?.closeAllConnections();
    for (const h of this.live) void h.close().catch(() => {});
    this.live.clear();
  }
}
