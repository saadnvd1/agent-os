import { describe, expect, it } from "vitest";
import { probeConnect, type ProbeDeps } from "./probeConnect";

const BOOT = "0123456789abcdef";
const NOW = Date.parse("2026-10-31T12:00:00Z");

const fetchError = (code: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: { code } });

function deps(
  answer: (url: string) => Response | Error,
  opts: { resolves?: boolean; date?: number } = {}
): ProbeDeps {
  return {
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("http://")) {
        return new Response(null, {
          headers: opts.date ? { date: new Date(opts.date).toUTCString() } : {},
        });
      }
      const a = answer(url);
      if (a instanceof Error) throw a;
      return a;
    }) as typeof fetch,
    resolves: async () => opts.resolves ?? true,
    now: () => NOW,
  };
}

const probe = (d: ProbeDeps) =>
  probeConnect("m-1.example.test", "api.example.test", BOOT, d);

describe("probeConnect", () => {
  it("our boot id: ok", async () => {
    expect(
      await probe(deps(() => Response.json({ ok: true, boot: BOOT })))
    ).toEqual({ kind: "ok" });
  });

  it("asks for the probe path on the Connect address", async () => {
    let asked = "";
    await probe(
      deps((url) => {
        asked = url;
        return Response.json({ boot: BOOT });
      })
    );
    expect(asked).toBe("https://m-1.example.test/api/reach/probe");
  });

  it.each([
    "m-1.example.test:8443",
    "m-1.example.test/x?",
    "user@m-1.example.test",
    "127.0.0.1",
    "",
  ])(
    "fetches nothing for a name that isn't a plain DNS name: %s",
    async (name) => {
      const asked: string[] = [];
      const d = deps((url) => {
        asked.push(url);
        return Response.json({ boot: BOOT });
      });
      expect(await probeConnect(name, "api.example.test", BOOT, d)).toEqual({
        kind: "dns",
        scope: "host",
      });
      expect(asked).toEqual([]);
    }
  );

  it("never asks a control host that isn't a plain DNS name", async () => {
    const asked: string[] = [];
    const d = deps(() => fetchError("CERT_HAS_EXPIRED"));
    const f = d.fetch;
    d.fetch = ((input, init) => {
      asked.push(String(input));
      return f(input, init);
    }) as typeof fetch;
    expect(
      await probeConnect("m-1.example.test", "evil.test:25/x", BOOT, d)
    ).toEqual({ kind: "tls", skewed: false });
    expect(asked).toEqual(["https://m-1.example.test/api/reach/probe"]);
  });

  it("another boot id: wrong origin", async () => {
    expect(await probe(deps(() => Response.json({ boot: "ffff" })))).toEqual({
      kind: "wrong-origin",
    });
  });

  it("421 (a listener not serving this name): wrong origin", async () => {
    expect(await probe(deps(() => new Response("", { status: 421 })))).toEqual({
      kind: "wrong-origin",
    });
  });

  it("530 / error 1033: the edge has no connector", async () => {
    expect(
      await probe(deps(() => new Response("error code: 1033", { status: 530 })))
    ).toEqual({ kind: "edge", status: 530, tunnel: true });
  });

  it("502: the edge couldn't reach the origin", async () => {
    expect(
      await probe(deps(() => new Response("bad gateway", { status: 502 })))
    ).toEqual({
      kind: "edge",
      status: 502,
      tunnel: false,
    });
  });

  it("this address doesn't resolve, others do: dns host", async () => {
    expect(await probe(deps(() => fetchError("ENOTFOUND")))).toEqual({
      kind: "dns",
      scope: "host",
    });
  });

  it("nothing resolves: dns all", async () => {
    expect(
      await probe(deps(() => fetchError("EAI_AGAIN"), { resolves: false }))
    ).toEqual({
      kind: "dns",
      scope: "all",
    });
  });

  it("expired certificate with the clock right: tls, not skewed", async () => {
    expect(
      await probe(
        deps(() => fetchError("CERT_HAS_EXPIRED"), { date: NOW + 1000 })
      )
    ).toEqual({
      kind: "tls",
      skewed: false,
    });
  });

  it("expired certificate with the clock a day off: tls, skewed", async () => {
    expect(
      await probe(
        deps(() => fetchError("CERT_HAS_EXPIRED"), { date: NOW + 86_400_000 })
      )
    ).toEqual({ kind: "tls", skewed: true });
  });

  it("a self-signed certificate (an intercepting proxy): tls", async () => {
    expect(
      await probe(deps(() => fetchError("SELF_SIGNED_CERT_IN_CHAIN")))
    ).toEqual({
      kind: "tls",
      skewed: false,
    });
  });

  it("no network: offline", async () => {
    expect(await probe(deps(() => fetchError("ENETUNREACH")))).toEqual({
      kind: "offline",
    });
  });

  it("no answer in time: timeout", async () => {
    const timeout = Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    expect(await probe(deps(() => timeout))).toEqual({ kind: "timeout" });
  });
});
