import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./index", async (orig) => ({
  ...(await orig<typeof import("./index")>()),
  hostExec: vi.fn(),
}));

import { getDb } from "../db";
import { createHost, hostExec } from "./index";
import { readCapped } from "./remote-api";
import {
  defaultLinkUrl,
  linkHost,
  normalizeLinkUrl,
  remotePort,
  tokenFromSetCookie,
} from "./link";

describe("linking another machine's AgentOS", () => {
  it("defaults to the ssh host on AgentOS's port", () => {
    expect(defaultLinkUrl("alice@devbox.tail.ts.net")).toBe(
      "http://devbox.tail.ts.net:3011"
    );
    expect(defaultLinkUrl("box")).toBe("http://box:3011");
  });

  it("takes an address and nothing else", () => {
    expect(normalizeLinkUrl(" http://box:3011/ ")).toBe("http://box:3011");
    expect(() => normalizeLinkUrl("file:///etc/passwd")).toThrow();
    expect(() => normalizeLinkUrl("http://u:p@box:3011")).toThrow();
    expect(() => normalizeLinkUrl("http://box:3011/?x=1")).toThrow();
  });

  it("asks for the pairing code on the address's port", () => {
    expect(remotePort("http://box:3013")).toBe(3013);
    expect(remotePort("https://box")).toBe(443);
  });

  it("reads the device token out of the pairing cookie", () => {
    expect(
      tokenFromSetCookie("aos_device=abc%2Bdef; Path=/; HttpOnly; SameSite=Lax")
    ).toBe("abc+def");
    expect(tokenFromSetCookie("other=1; Path=/")).toBeNull();
    expect(tokenFromSetCookie(null)).toBeNull();
  });
});

describe("linkHost", () => {
  const fetchMock = vi.fn();
  let hostId: string;
  const links = () =>
    getDb()
      .prepare(`SELECT url, token FROM host_links WHERE host_id = ?`)
      .all(hostId);

  beforeAll(() => {
    hostId = createHost("box", "alice@box.tail.ts.net").id;
    vi.stubGlobal("fetch", fetchMock);
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(hostExec).mockReset();
    vi.mocked(hostExec).mockResolvedValue({
      stdout: JSON.stringify({ code: "ABCD1234ABCD1234" }),
      stderr: "",
    });
  });

  const claimed = (cookie: string | null, status = 200) =>
    new Response(
      JSON.stringify(status === 200 ? {} : { error: "\u001b[31mno\u001b[0m" }),
      {
        status,
        headers: cookie ? { "set-cookie": cookie } : {},
      }
    );

  it("asks the machine for a code over ssh, claims it there, and keeps the token", async () => {
    fetchMock
      .mockResolvedValueOnce(claimed("aos_device=tok%2B1; Path=/; HttpOnly"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [] })));
    await expect(linkHost(hostId)).resolves.toEqual({
      url: "http://box.tail.ts.net:3011",
    });
    expect(vi.mocked(hostExec).mock.calls[0][1]).toContain(
      "http://127.0.0.1:3011/api/pair/start"
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://box.tail.ts.net:3011/api/pair/claim"
    );
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer tok+1"
    );
    expect(links()).toEqual([
      { url: "http://box.tail.ts.net:3011", token: "tok+1" },
    ]);
    getDb().prepare(`DELETE FROM host_links WHERE host_id = ?`).run(hostId);
  });

  it("never sends the code anywhere but the machine itself", async () => {
    await expect(linkHost(hostId, "https://attacker.example")).rejects.toThrow(
      /must be box.tail.ts.net/
    );
    expect(hostExec).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps nothing when the claim is refused, sends no token, or the token doesn't work", async () => {
    fetchMock.mockResolvedValueOnce(claimed(null, 400));
    const refused = await linkHost(hostId).catch((e: Error) => e.message);
    expect(refused).toMatch(/refused the pairing/);
    expect(refused).not.toContain("\u001b");
    fetchMock.mockResolvedValueOnce(claimed(null));
    await expect(linkHost(hostId)).rejects.toThrow(/sent no token/);
    fetchMock
      .mockResolvedValueOnce(claimed("aos_device=tok"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "pairing required" }), {
          status: 401,
        })
      );
    await expect(linkHost(hostId)).rejects.toThrow(/pairing required/);
    expect(links()).toEqual([]);
  });

  it("won't link this machine", async () => {
    await expect(linkHost("local")).rejects.toThrow(/another machine/);
  });
});

describe("readCapped", () => {
  it("stops reading past the cap even with no size header", async () => {
    const body = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(1024));
      },
    });
    await expect(readCapped(new Response(body), 4096)).rejects.toThrow(
      /too large/
    );
    await expect(readCapped(new Response("ok"), 4096)).resolves.toBe("ok");
  });
});
