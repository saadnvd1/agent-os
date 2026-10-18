import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAuth } from "../driver";
import type { ChatItem, McpServerView } from "../events";
import type { WorkerEvent } from "./protocol";
import {
  handleMcpAuth,
  stopMcpWatches,
  WATCH_EVERY_MS,
  WATCH_FOR_MS,
} from "./mcp-auth";

const view = (status: McpServerView["status"]): McpServerView => ({
  name: "linear",
  status,
  tools: status === "connected" ? [{ name: "list_issues" }] : [],
});

let servers: McpServerView[];
let auth: { [K in keyof McpAuth]: ReturnType<typeof vi.fn> };
let events: WorkerEvent[];
let recorded: ChatItem[];
const stored: ChatItem = {
  id: "mcp-1",
  kind: "mcp",
  servers: [view("needs-auth")],
  createdAt: 1,
};
const host = () => ({
  emit: (e: WorkerEvent) => events.push(e),
  record: (i: ChatItem) => recorded.push(i),
  item: (id: string) => (id === "mcp-1" ? stored : undefined),
});
const run = (cmd: Partial<Parameters<typeof handleMcpAuth>[0]>) =>
  handleMcpAuth(
    {
      type: "mcp_auth",
      reqId: "r1",
      action: "start",
      server: "linear",
      itemId: "mcp-1",
      ...cmd,
    },
    { mcpAuth: auth as unknown as McpAuth },
    host()
  );

beforeEach(() => {
  vi.useFakeTimers();
  servers = [view("needs-auth")];
  events = [];
  recorded = [];
  auth = {
    start: vi.fn(async () => ({
      mode: "callback",
      authUrl: "https://a.example/auth",
      state: "s1",
    })),
    submit: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {
      servers = [view("connected")];
    }),
    servers: vi.fn(async () => servers),
  };
});
afterEach(() => vi.useRealTimers());

describe("handleMcpAuth", () => {
  it("start answers with the link and the state, and records nothing yet", async () => {
    await run({ redirectUri: "https://x/api/mcp-auth/callback" });
    expect(auth.start).toHaveBeenCalledWith(
      "linear",
      "https://x/api/mcp-auth/callback"
    );
    expect(events).toEqual([
      {
        type: "mcp_auth_result",
        reqId: "r1",
        start: {
          mode: "callback",
          authUrl: "https://a.example/auth",
          state: "s1",
        },
      },
    ]);
    expect(recorded).toEqual([]);
  });

  it("submit hands over the address, reconnects, and rewrites the same list", async () => {
    await run({ action: "submit", url: "https://x/cb?code=c&state=s1" });
    expect(auth.submit).toHaveBeenCalledWith(
      "linear",
      "https://x/cb?code=c&state=s1"
    );
    expect(auth.reconnect).toHaveBeenCalledWith("linear");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      id: "mcp-1",
      kind: "mcp",
      servers: [{ name: "linear", status: "connected" }],
    });
    expect(events[0]).toEqual({ type: "mcp_auth_result", reqId: "r1" });
  });

  it("still refreshes the list when the reconnect fails, and says why with keys redacted", async () => {
    auth.reconnect.mockRejectedValue(
      new Error("failed https://mcp.example/sse?api_key=sekrit")
    );
    await run({ action: "reconnect" });
    expect(recorded).toHaveLength(1);
    const reply = events[0] as Extract<
      WorkerEvent,
      { type: "mcp_auth_result" }
    >;
    expect(reply.error).toContain("failed");
    expect(reply.error).not.toContain("sekrit");
  });

  it("a silent sign-in reconnects at once", async () => {
    auth.start.mockResolvedValue({ mode: "done" });
    await run({});
    expect(auth.reconnect).toHaveBeenCalled();
    expect(recorded[0]).toMatchObject({
      servers: [{ status: "connected" }],
    });
  });

  it("watches a sign-in the browser can't finish, and stops once the server is back", async () => {
    auth.start.mockResolvedValue({ mode: "paste", authUrl: "https://a/b" });
    await run({});
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS);
    expect(recorded).toEqual([]);
    servers = [view("connected")];
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS);
    expect(recorded).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS * 3);
    expect(recorded).toHaveLength(1);
  });

  it("gives up watching after ten minutes", async () => {
    auth.start.mockResolvedValue({ mode: "external", authUrl: "https://a/b" });
    await run({});
    await vi.advanceTimersByTimeAsync(WATCH_FOR_MS + WATCH_EVERY_MS * 2);
    const calls = auth.servers.mock.calls.length;
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS * 5);
    expect(auth.servers.mock.calls.length).toBe(calls);
  });

  it("stops watching when the conversation closes", async () => {
    auth.start.mockResolvedValue({ mode: "paste", authUrl: "https://a/b" });
    await run({});
    stopMcpWatches(auth);
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS * 3);
    expect(auth.servers).not.toHaveBeenCalled();
  });

  it("reports an agent that can't sign in", async () => {
    await handleMcpAuth(
      {
        type: "mcp_auth",
        reqId: "r1",
        action: "start",
        server: "linear",
        itemId: "mcp-1",
      },
      {},
      host()
    );
    expect(events[0]).toMatchObject({ error: expect.stringMatching(/can't/) });
  });
});
