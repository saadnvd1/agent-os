import { afterEach, describe, expect, it, vi } from "vitest";
import { claimCode, pairTrusted, probeMachine } from "./pairing";

const URL = "http://100.64.0.1:3011";

function answer(status: number, body: unknown) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("probeMachine", () => {
  it("trusts a machine that answers /api/devices, and says how", async () => {
    vi.stubGlobal(
      "fetch",
      answer(200, { devices: [], current: { via: "tailnet" } })
    );
    expect(await probeMachine(URL)).toEqual({
      state: "trusted",
      via: "tailnet",
    });
  });

  it("pairs rather than ride a credential that isn't ours", async () => {
    vi.stubGlobal(
      "fetch",
      answer(200, { devices: [], current: { via: "device" } })
    );
    expect(await probeMachine(URL)).toEqual({ state: "needs-pairing" });
    expect(await probeMachine(URL, "aosd_x")).toEqual({
      state: "trusted",
      via: "device",
    });
  });

  it("sends no cookies", async () => {
    const fetch = answer(200, { current: { via: "tailnet" } });
    vi.stubGlobal("fetch", fetch);
    await probeMachine(URL);
    expect(fetch.mock.calls[0][1]?.credentials).toBe("omit");
  });

  it("asks to pair on a 401, and sends the token it has", async () => {
    const fetch = answer(401, { error: "pairing required" });
    vi.stubGlobal("fetch", fetch);
    expect(await probeMachine(URL, "aosd_x")).toEqual({
      state: "needs-pairing",
    });
    const headers = fetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer aosd_x");
  });

  it("calls any other failure unreachable, never a reason to pair", async () => {
    vi.stubGlobal("fetch", answer(403, { error: "forbidden" }));
    expect(await probeMachine(URL)).toEqual({
      state: "unreachable",
      error: "forbidden",
    });
    vi.stubGlobal("fetch", answer(500, {}));
    expect((await probeMachine(URL)).state).toBe("unreachable");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Network request failed")))
    );
    expect(await probeMachine(URL)).toEqual({
      state: "unreachable",
      error: "Can't reach the machine.",
    });
  });
});

describe("claimCode", () => {
  it("asks for the token in the body and returns it", async () => {
    const fetch = answer(200, {
      device: { id: "d1", name: "iPhone" },
      token: "aosd_t",
    });
    vi.stubGlobal("fetch", fetch);
    expect(await claimCode(URL, "ABCD-EFGH-JKMN-PQRS", "iPhone")).toEqual({
      deviceId: "d1",
      token: "aosd_t",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${URL}/api/pair/claim`);
    expect(JSON.parse(String(init?.body))).toEqual({
      code: "ABCD-EFGH-JKMN-PQRS",
      name: "iPhone",
      token: true,
    });
  });

  it("refuses a server that pairs but returns no token", async () => {
    vi.stubGlobal(
      "fetch",
      answer(200, { device: { id: "d1", name: "iPhone" } })
    );
    await expect(claimCode(URL, "code", "iPhone")).rejects.toThrow(
      /too old to pair/
    );
  });

  it("passes the server's refusal through", async () => {
    vi.stubGlobal(
      "fetch",
      answer(400, { error: "That code is wrong, used or expired." })
    );
    await expect(claimCode(URL, "code", "iPhone")).rejects.toThrow(
      /wrong, used or expired/
    );
  });
});

describe("pairTrusted", () => {
  it("pairs a phone the machine already trusts and returns the token", async () => {
    const fetch = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/start")
              ? { code: "C0DE" }
              : { device: { id: "d1" }, token: "aosd_t" }
          ),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetch);
    expect(await pairTrusted(URL, "iPhone")).toBe("aosd_t");
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      `${URL}/api/pair/start`,
      `${URL}/api/pair/claim`,
    ]);
  });

  it("revokes the device it made when an older server keeps the token", async () => {
    const fetch = vi.fn(
      async (url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            url.endsWith("/start")
              ? { code: "C0DE" }
              : init?.method === "DELETE"
                ? {}
                : { device: { id: "d1" } }
          ),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetch);
    expect(await pairTrusted(URL, "iPhone")).toBeNull();
    expect(fetch.mock.calls[2]).toEqual([
      `${URL}/api/devices/d1`,
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });

  it("gives up quietly when the machine won't start a pairing", async () => {
    vi.stubGlobal("fetch", answer(403, { error: "local only" }));
    expect(await pairTrusted(URL, "iPhone")).toBeNull();
  });
});
