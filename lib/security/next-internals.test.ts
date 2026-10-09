import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { refusedNextInternal } from "./next-internals";

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

  it("runs in server.ts before the auth gate and before Next", () => {
    const server = fs.readFileSync(
      path.resolve(__dirname, "../../server.ts"),
      "utf8"
    );
    const refuse = server.indexOf("if (refusedNextInternal(req.url))");
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(server.indexOf("gateRequest(req, res, auth)"));
    expect(refuse).toBeLessThan(server.indexOf("await handle(req, res"));
  });
});
