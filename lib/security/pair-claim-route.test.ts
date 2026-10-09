import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/pair/claim/route";
import { MAX_CLAIM_BYTES } from "./read-capped";
import { startPairing } from "./pairing";

const claim = (body: BodyInit) =>
  POST(
    new NextRequest("http://x/api/pair/claim", {
      method: "POST",
      body,
      // A streamed body needs this in Node's fetch.
      ...({ duplex: "half" } as object),
    })
  );

describe("POST /api/pair/claim body size", () => {
  it("refuses a body over the cap", async () => {
    const big = JSON.stringify({
      code: "1",
      name: "x".repeat(MAX_CLAIM_BYTES),
    });
    expect((await claim(big)).status).toBe(413);
  });

  it("refuses an oversized streamed body with no length given", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 64) c.enqueue(chunk);
        else c.close();
      },
    });
    expect((await claim(stream)).status).toBe(413);
    // It stopped reading soon after the cap, not at the end.
    expect(sent).toBeLessThan(16);
  });

  it("still reads a normal claim and pairs", async () => {
    const { code } = startPairing();
    const res = await claim(
      JSON.stringify({ code, name: "phone", token: true })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      device: { name: "phone" },
      token: expect.any(String),
    });
  });

  it("checks a wrong code it read, rather than finding none", async () => {
    const res = await claim(JSON.stringify({ code: "000000", name: "phone" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/wrong, used or expired/),
    });
  });

  it("treats a body that isn't JSON as no code", async () => {
    expect((await claim("not json")).status).toBe(400);
  });
});
