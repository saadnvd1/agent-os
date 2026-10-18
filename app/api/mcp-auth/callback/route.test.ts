import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const finish = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/mcp-auth", () => ({ finishMcpSignInFromRedirect: finish }));

const { GET } = await import("./route");
const get = (query: string) =>
  GET(new NextRequest(`http://localhost:3011/api/mcp-auth/callback?${query}`));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/mcp-auth/callback", () => {
  it("hands the query string over and says which server signed in, escaped", async () => {
    finish.mockResolvedValue({ server: "<b>linear</b>" });
    const res = await get("code=c&state=s");
    const html = await res.text();
    // Only the query string goes on: the origin comes from the pending sign-in
    expect(finish).toHaveBeenCalledWith("?code=c&state=s");
    expect(res.status).toBe(200);
    expect(html).toContain("&lt;b&gt;linear&lt;/b&gt;");
    expect(html).not.toContain("<b>linear");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("shows a refusal as a page, never throws", async () => {
    finish.mockRejectedValue(new Error("That sign-in expired"));
    const res = await get("code=c&state=s");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("That sign-in expired");
  });

  it("shows the provider's error escaped", async () => {
    finish.mockResolvedValue({ server: "x" });
    const res = await get("error=access_denied&error_description=%3Cscript%3E");
    const html = await res.text();
    expect(res.status).toBe(400);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
