import { describe, it, expect, vi } from "vitest";
import { LumifyHubClient, LumifyHubError } from "./client";

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );

describe("LumifyHubClient", () => {
  it("sends the bearer token and unwraps data", async () => {
    const fetchImpl = reply(200, { data: [{ id: "w", name: "W", slug: "w" }] });
    const client = new LumifyHubClient("https://lh.test", "lhcli_x", fetchImpl);
    expect(await client.listWorkspaces()).toEqual([
      { id: "w", name: "W", slug: "w" },
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://lh.test/api/cli/workspaces");
    expect(init.headers.Authorization).toBe("Bearer lhcli_x");
    expect(init.redirect).toBe("error");
  });

  it("reads a 401 as disconnected", async () => {
    const client = new LumifyHubClient(
      "https://lh.test",
      "lhcli_old",
      reply(401, { error: "Invalid or revoked CLI token" })
    );
    const error = await client.validate().catch((e) => e);
    expect(error).toBeInstanceOf(LumifyHubError);
    expect(error.disconnected).toBe(true);
    expect(error.message).toBe("LumifyHub disconnected");
  });

  it("passes other errors through without disconnecting", async () => {
    const client = new LumifyHubClient(
      "https://lh.test",
      "lhcli_x",
      reply(422, { error: "Ticket prefix taken" })
    );
    const error = await client.createBoard("ws", "B").catch((e) => e);
    expect(error.disconnected).toBe(false);
    expect(error.status).toBe(422);
    expect(error.message).toBe("Ticket prefix taken");
  });

  it("never puts the token in an unreachable error", async () => {
    const client = new LumifyHubClient(
      "https://lh.test",
      "lhcli_secret",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );
    const error = await client.listWorkspaces().catch((e) => e);
    expect(error.status).toBe(0);
    expect(error.message).not.toContain("lhcli_secret");
  });
});
