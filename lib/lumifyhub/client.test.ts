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

  it("encodes ids in paths", async () => {
    const fetchImpl = reply(200, { data: {} });
    const client = new LumifyHubClient("https://lh.test", "t", fetchImpl);
    await client.getCard("../../workspaces", "a/b?c");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://lh.test/api/cli/boards/..%2F..%2Fworkspaces/cards/a%2Fb%3Fc"
    );
  });
});

describe("card dependencies", () => {
  const dep = {
    id: "c2",
    ticket: "ENG-2",
    title: "B",
    list_id: "l",
    completed: false,
  };

  it("reads blocked_by and blocks", async () => {
    const fetchImpl = reply(200, { data: { blocked_by: [dep], blocks: [] } });
    const client = new LumifyHubClient("https://lh.test", "t", fetchImpl);
    expect(await client.cardDependencies("b1", "c1")).toEqual({
      blocked_by: [dep],
      blocks: [],
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://lh.test/api/cli/boards/b1/cards/c1/dependencies"
    );
  });

  it("adds by ticket and passes a validation error through", async () => {
    const fetchImpl = reply(400, { error: "That would create a cycle" });
    const client = new LumifyHubClient("https://lh.test", "t", fetchImpl);
    const error = await client
      .addDependency("b1", "c1", "ENG-2")
      .catch((e) => e);
    expect(error.status).toBe(400);
    expect(error.message).toBe("That would create a cycle");
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ blocked_by: "ENG-2" });
  });

  it("removes one", async () => {
    const data = { card_id: "c1", blocked_by_card_id: "c2", deleted: true };
    const fetchImpl = reply(200, { data });
    const client = new LumifyHubClient("https://lh.test", "t", fetchImpl);
    expect(await client.removeDependency("b1", "c1", "c2")).toEqual(data);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://lh.test/api/cli/boards/b1/cards/c1/dependencies/c2"
    );
    expect(fetchImpl.mock.calls[0][1].method).toBe("DELETE");
  });
});
