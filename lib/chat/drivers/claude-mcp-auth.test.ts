import { describe, expect, it, vi } from "vitest";
import type { McpServerStatus, Query } from "@anthropic-ai/claude-agent-sdk";
import { mcpView } from "./claude";
import {
  canSignIn,
  claudeMcpAuth,
  safeAuthUrl,
  toSignInStart,
} from "./claude-mcp-auth";

describe("toSignInStart", () => {
  it("a custom redirect returns to AgentOS", () => {
    expect(
      toSignInStart({
        authUrl: "https://as.example/authorize?x=1",
        requiresUserAction: true,
        callbackExpected: true,
        redirectScheme: "custom",
        state: "abc",
      })
    ).toEqual({
      mode: "callback",
      authUrl: "https://as.example/authorize?x=1",
      state: "abc",
    });
  });

  it("a localhost redirect means pasting the address back", () => {
    expect(
      toSignInStart({
        authUrl: "https://as.example/a",
        requiresUserAction: true,
        callbackExpected: true,
        redirectScheme: "localhost",
        callbackPort: 5555,
        state: "abc",
      }).mode
    ).toBe("paste");
  });

  it("claude.ai connectors finish elsewhere; a silent sign-in needs nothing", () => {
    expect(
      toSignInStart({
        authUrl: "https://claude.ai/x",
        requiresUserAction: true,
        callbackExpected: false,
      }).mode
    ).toBe("external");
    expect(
      toSignInStart({ requiresUserAction: false, callbackExpected: false })
    ).toEqual({ mode: "done" });
  });

  it("won't offer a link a person shouldn't open", () => {
    for (const authUrl of ["javascript:alert(1)", "http://evil.example/a", "x"])
      expect(() =>
        toSignInStart({
          authUrl,
          requiresUserAction: true,
          callbackExpected: true,
        })
      ).toThrow(/won't open/);
    expect(safeAuthUrl("http://localhost:3000/a")).toBeTruthy();
  });
});

describe("canSignIn / mcpView", () => {
  const s = (over: Partial<McpServerStatus>): McpServerStatus => ({
    name: "x",
    status: "needs-auth",
    ...over,
  });
  it("offers sign-in only to a server that needs it and speaks HTTP", () => {
    expect(canSignIn(s({ config: { type: "http", url: "https://a" } }))).toBe(
      true
    );
    expect(canSignIn(s({ config: { type: "sse", url: "https://a" } }))).toBe(
      true
    );
    expect(
      canSignIn(
        s({ config: { type: "claudeai-proxy", url: "https://a", id: "1" } })
      )
    ).toBe(true);
    expect(canSignIn(s({ config: { type: "stdio", command: "x" } }))).toBe(
      false
    );
    expect(canSignIn(s({ config: { command: "x" } as never }))).toBe(false);
    expect(
      canSignIn(
        s({ status: "connected", config: { type: "http", url: "https://a" } })
      )
    ).toBe(false);
  });
  it("marks the view", () => {
    expect(
      mcpView(s({ config: { type: "http", url: "https://a" } })).signIn
    ).toBe(true);
    expect(mcpView(s({ status: "failed" })).signIn).toBeUndefined();
  });
});

describe("claudeMcpAuth", () => {
  it("calls the CLI's sign-in and reconnect on the query", async () => {
    const q = {
      mcpAuthenticate: vi.fn(async () => ({
        authUrl: "https://as.example/a",
        requiresUserAction: true,
        callbackExpected: true,
        redirectScheme: "custom",
      })),
      mcpSubmitOAuthCallbackUrl: vi.fn(async () => ({})),
      reconnectMcpServer: vi.fn(async () => {}),
      mcpServerStatus: vi.fn(async () => [
        { name: "x", status: "connected" } as McpServerStatus,
      ]),
    };
    const auth = claudeMcpAuth(q as unknown as Query, mcpView);
    expect((await auth.start("x", "https://h/cb")).mode).toBe("callback");
    expect(q.mcpAuthenticate).toHaveBeenCalledWith("x", "https://h/cb");
    await auth.submit("x", "https://h/cb?code=1");
    expect(q.mcpSubmitOAuthCallbackUrl).toHaveBeenCalledWith(
      "x",
      "https://h/cb?code=1"
    );
    await auth.reconnect("x");
    expect(q.reconnectMcpServer).toHaveBeenCalledWith("x");
    expect((await auth.servers())[0].status).toBe("connected");
  });

  it("says so when the SDK has no sign-in call", async () => {
    const auth = claudeMcpAuth({} as Query, mcpView);
    await expect(auth.start("x")).rejects.toThrow(/can't sign in/);
    await expect(auth.submit("x", "u")).rejects.toThrow(/can't sign in/);
  });
});
