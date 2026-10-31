import { describe, expect, it } from "vitest";
import { GET } from "./route";

// Public before pairing: it may only ever say "AgentOS, this boot".
describe("GET /api/reach/probe", () => {
  it("answers the same two fields to everyone, all boot long, uncached", async () => {
    const a = GET();
    const b = GET();
    const body = await a.json();
    expect(Object.keys(body).sort()).toEqual(["boot", "ok"]);
    expect(body).toEqual({
      ok: true,
      boot: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(await b.json()).toEqual(body);
    expect(a.headers.get("cache-control")).toBe("no-store");
  });

  it("takes no input", () => {
    expect(GET.length).toBe(0);
  });
});
