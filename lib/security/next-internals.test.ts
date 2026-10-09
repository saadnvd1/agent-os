import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { refuseNextInternal, refusedNextInternal } from "./next-internals";

describe("refusedNextInternal", () => {
  it("refuses Next's image optimizer, however the path is spelled", () => {
    for (const url of [
      "/_next/image?url=%2Fapi%2Fsessions&w=64&q=75",
      "/_next/image",
      "/_next/image/",
      "//_next//image?url=/api/x",
      "/_next/%69mage?url=/api/x",
      "/%5Fnext/image?url=/api/x",
      "/%255Fnext%252Fimage?url=/api/x",
      "/_NEXT/IMAGE?url=/api/x",
      "/_next/static/../image?url=/api/x",
      "/_next\\image?url=/api/x",
      "/%E0%A4%A",
    ])
      expect(refusedNextInternal(url), url).toBe(true);
  });

  it("leaves everything else alone", () => {
    for (const url of [
      "/",
      "/_next/static/chunks/main.js",
      "/api/sessions",
      "/images/logo.png",
      "/_next/imagery",
    ])
      expect(refusedNextInternal(url), url).toBe(false);
  });

  it("answers a refused request 404 and stops it; lets others go on", () => {
    const res = {
      statusCode: 200,
      ended: false,
      end() {
        res.ended = true;
      },
    };
    const r = res as unknown as Parameters<typeof refuseNextInternal>[1];
    expect(
      refuseNextInternal(
        { url: "/_next/image?url=%2Fapi%2Fsessions&w=64&q=75" },
        r
      )
    ).toBe(true);
    expect(res).toMatchObject({ statusCode: 404, ended: true });
    const other = {
      statusCode: 200,
      ended: false,
      end() {
        other.ended = true;
      },
    };
    expect(
      refuseNextInternal({ url: "/api/sessions" }, other as unknown as typeof r)
    ).toBe(false);
    expect(other).toMatchObject({ statusCode: 200, ended: false });
  });

  // One handler serves every listener (loopback, tailnet, tailnet HTTPS,
  // Connect); the refusal is its first check after the host/origin check,
  // unconditional, and stops the request.
  it("is the first thing server.ts's request handler does after the host check", () => {
    const server = fs.readFileSync(
      path.resolve(__dirname, "../../server.ts"),
      "utf8"
    );
    const handler = server.slice(server.indexOf("const onRequest"));
    const body = handler.slice(0, handler.indexOf("\n  };\n"));
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//"));
    const refuse = lines.indexOf("if (refuseNextInternal(req, res)) return;");
    expect(refuse).toBeGreaterThan(-1);
    expect(lines.slice(0, refuse).join(" ")).toMatch(
      /^const onRequest[^]*requestAllowed\([^]*return;\s*}$/
    );
    expect(lines[refuse + 1]).toBe("if (!gateRequest(req, res, auth)) return;");
    for (const l of [
      ...server.matchAll(
        /(startConnect|startTailnetHttps)\([^]*?handlers?[^]*?\)/g
      ),
    ])
      expect(l[0]).toMatch(/onRequest/);
  });
});
