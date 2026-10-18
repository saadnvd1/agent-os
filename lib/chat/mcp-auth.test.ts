import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mcpAuth: vi.fn(),
  worker: vi.fn(),
  item: vi.fn(),
}));
vi.mock("./runner", () => ({
  mcpAuthWorker: (id: string) => mocks.worker(id),
}));
vi.mock("./store", () => ({ getItem: mocks.item }));

const {
  PENDING_MS,
  cleanOrigin,
  finishMcpSignIn,
  finishMcpSignInFromRedirect,
  reconnectMcpServer,
  resetMcpSignIns,
  startMcpSignIn,
} = await import("./mcp-auth");

const list = (signIn: boolean) => ({
  id: "mcp-1",
  kind: "mcp",
  servers: [{ name: "linear", status: "needs-auth", signIn, tools: [] }],
});

beforeEach(() => {
  vi.clearAllMocks();
  resetMcpSignIns();
  mocks.worker.mockReturnValue({ mcpAuth: mocks.mcpAuth });
  mocks.item.mockReturnValue(list(true));
  mocks.mcpAuth.mockResolvedValue({
    start: { mode: "callback", authUrl: "https://a.example/auth", state: "s1" },
  });
});
afterEach(() => vi.useRealTimers());

const start = (origin: string | null = "https://mac.ts.net:3443") =>
  startMcpSignIn("sess", { itemId: "mcp-1", server: "linear", origin });

describe("startMcpSignIn", () => {
  it("asks the agent to return to this browser's AgentOS, and hides the state", async () => {
    expect(await start()).toEqual({
      mode: "callback",
      authUrl: "https://a.example/auth",
    });
    expect(mocks.mcpAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "start",
        server: "linear",
        redirectUri: "https://mac.ts.net:3443/api/mcp-auth/callback",
      }),
      expect.any(Number)
    );
  });

  it("asks for no redirect without a usable origin", async () => {
    await start("javascript:alert(1)");
    expect(mocks.mcpAuth.mock.calls[0][0].redirectUri).toBeUndefined();
  });

  it("refuses a server the list doesn't offer sign-in for, without asking the agent", async () => {
    mocks.item.mockReturnValue(list(false));
    await expect(start()).rejects.toThrow(/can't sign in/);
    mocks.item.mockReturnValue(undefined);
    await expect(start()).rejects.toThrow(/gone/);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("passes on why the agent can't (another machine, older worker)", async () => {
    mocks.worker.mockImplementation(() => {
      throw new Error("older AgentOS build");
    });
    await expect(start()).rejects.toThrow(/older AgentOS build/);
  });

  it("reports the agent's error", async () => {
    mocks.mcpAuth.mockResolvedValue({ error: "no OAuth here" });
    await expect(start()).rejects.toThrow("no OAuth here");
  });
});

describe("finishMcpSignIn", () => {
  const back = "https://mac.ts.net:3443/api/mcp-auth/callback?code=c&state=s1";

  it("gives the agent the exact address, once", async () => {
    await start();
    mocks.mcpAuth.mockResolvedValue({});
    expect(await finishMcpSignIn(back)).toEqual({ server: "linear" });
    expect(mocks.worker).toHaveBeenLastCalledWith("sess");
    expect(mocks.mcpAuth).toHaveBeenLastCalledWith({
      action: "submit",
      server: "linear",
      itemId: "mcp-1",
      url: back,
    });
    await expect(finishMcpSignIn(back)).rejects.toThrow(/already used/);
  });

  it("refuses a state it never issued", async () => {
    await expect(finishMcpSignIn(back)).rejects.toThrow(/expired/);
    await expect(finishMcpSignIn("not a url")).rejects.toThrow();
    expect(mocks.mcpAuth).not.toHaveBeenCalled();
  });

  it("refuses a sign-in that waited too long", async () => {
    vi.useFakeTimers();
    await start();
    vi.advanceTimersByTime(PENDING_MS + 1);
    await expect(finishMcpSignIn(back)).rejects.toThrow(/expired/);
  });

  it("pins a pasted address to the row it was typed in", async () => {
    await start();
    await expect(
      finishMcpSignIn(back, { sessionId: "sess", server: "other" })
    ).rejects.toThrow(/different/);
    await expect(
      finishMcpSignIn(back, { sessionId: "elsewhere", server: "linear" })
    ).rejects.toThrow(/different/);
    // A refused paste doesn't use the attempt up.
    mocks.mcpAuth.mockResolvedValue({});
    await finishMcpSignIn(back, { sessionId: "sess", server: "linear" });
  });

  it("a newer start for the same server voids the older one", async () => {
    await start();
    mocks.mcpAuth.mockResolvedValue({
      start: { mode: "callback", authUrl: "https://a.example/2", state: "s2" },
    });
    await start();
    await expect(finishMcpSignIn(back)).rejects.toThrow(/expired/);
    mocks.mcpAuth.mockResolvedValue({});
    await finishMcpSignIn(back.replace("s1", "s2"));
  });

  it("reports a failed exchange", async () => {
    await start();
    mocks.mcpAuth.mockResolvedValue({ error: "token exchange failed" });
    await expect(finishMcpSignIn(back)).rejects.toThrow(
      "token exchange failed"
    );
  });
});

describe("finishMcpSignInFromRedirect", () => {
  it("rebuilds the address from the origin the sign-in started with", async () => {
    await start();
    mocks.mcpAuth.mockResolvedValue({});
    await finishMcpSignInFromRedirect("?code=c&state=s1");
    expect(mocks.mcpAuth).toHaveBeenLastCalledWith({
      action: "submit",
      server: "linear",
      itemId: "mcp-1",
      url: "https://mac.ts.net:3443/api/mcp-auth/callback?code=c&state=s1",
    });
  });

  it("refuses an unknown state, or one that started without a redirect", async () => {
    await expect(
      finishMcpSignInFromRedirect("?code=c&state=nope")
    ).rejects.toThrow(/expired/);
    await start(null);
    await expect(
      finishMcpSignInFromRedirect("?code=c&state=s1")
    ).rejects.toThrow(/expired/);
  });
});

describe("pending sign-ins across bundles", () => {
  it("a freshly imported module finishes what another one started", async () => {
    await start();
    vi.resetModules();
    const other = await import("./mcp-auth");
    mocks.mcpAuth.mockResolvedValue({});
    await expect(
      other.finishMcpSignInFromRedirect("?code=c&state=s1")
    ).resolves.toEqual({ server: "linear" });
    await expect(
      other.finishMcpSignInFromRedirect("?code=c&state=s1")
    ).rejects.toThrow(/expired/);
  });
});

describe("reconnectMcpServer", () => {
  it("asks the agent to reconnect that server", async () => {
    mocks.mcpAuth.mockResolvedValue({});
    await reconnectMcpServer("sess", { itemId: "mcp-1", server: "linear" });
    expect(mocks.mcpAuth).toHaveBeenCalledWith(
      { action: "reconnect", itemId: "mcp-1", server: "linear" },
      expect.any(Number)
    );
  });
});

describe("cleanOrigin", () => {
  it("accepts only a bare http(s) origin", () => {
    expect(cleanOrigin("https://a.b:3443")).toBe("https://a.b:3443");
    expect(cleanOrigin("https://a.b/x")).toBeNull();
    expect(cleanOrigin("ftp://a.b")).toBeNull();
    expect(cleanOrigin(null)).toBeNull();
  });
});
