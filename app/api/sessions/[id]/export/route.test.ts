import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@/lib/test-temp";

process.env.AGENTOS_ARTIFACTS_DIR = tempDir("agentos-export-art-");
const file = await import("./route");
const estimate = await import("./estimate/route");
const { saveItem } = await import("@/lib/chat/store");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");

const secret = ["gh", "p_", "c".repeat(36)].join("");
const body = {
  format: "md",
  mode: "compact",
  redact: "all",
};

const post = (b: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function session(view: "chat" | "terminal" = "chat") {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({ projectId: project.id, name: "Export me", view });
  let t = 1;
  const add = (i: Record<string, unknown>) =>
    saveItem(id, { id: `x${t}`, createdAt: t++, ...i } as never);
  add({ kind: "user", text: `key ${secret}` });
  add({ kind: "assistant", text: "ok" });
  add({ kind: "user", text: "second" });
  add({ kind: "assistant", text: "done" });
  return id;
}

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/sessions/:id/export", () => {
  it("returns each format as a named download with size headers", async () => {
    const id = session();
    for (const [format, type, ext] of [
      ["md", "text/markdown", "md"],
      ["json", "application/json", "json"],
      ["html", "text/html", "html"],
    ]) {
      const res = await file.POST(post({ ...body, format }), params(id));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(type);
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="export-me-all.${ext}"`
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(Number(res.headers.get("x-export-bytes"))).toBe(
        Buffer.byteLength(text)
      );
      expect(Number(res.headers.get("x-export-tokens"))).toBeGreaterThan(0);
      expect(text).not.toContain(secret);
    }
  });

  it("exports a range and names it", async () => {
    const id = session();
    const res = await file.POST(
      post({ ...body, range: { from: 2, to: 2 } }),
      params(id)
    );
    expect(res.headers.get("content-disposition")).toContain("-turn-2.md");
    const text = await res.text();
    expect(text).toContain("second");
    expect(text).not.toContain("## Turn 1");
  });

  it("404s an unknown session and 400s a terminal one", async () => {
    expect((await file.POST(post(body), params("nope"))).status).toBe(404);
    const res = await file.POST(post(body), params(session("terminal")));
    expect(res.status).toBe(400);
  });

  it("400s a bad format, mode, redaction or range", async () => {
    const id = session();
    for (const bad of [
      { ...body, format: "pdf" },
      { ...body, mode: "tiny" },
      { ...body, redact: "none" },
      { ...body, range: { from: 0, to: 2 } },
      { ...body, range: { from: 9, to: 12 } },
      { ...body, range: { last: -1 } },
    ])
      expect((await file.POST(post(bad), params(id))).status).toBe(400);
  });

  it("refuses in the demo", async () => {
    vi.stubEnv("AGENTOS_DEMO", "1");
    const res = await file.POST(post(body), params(session()));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/sessions/:id/export/estimate", () => {
  it("returns sizes, turns and warnings, and no body text", async () => {
    const id = session();
    const res = await estimate.POST(post(body), params(id));
    expect(res.status).toBe(200);
    const text = await res.text();
    const j = JSON.parse(text);
    expect(j.turns.map((t: { n: number }) => t.n)).toEqual([1, 2]);
    expect(j.selected).toMatchObject({ from: 1, to: 2, of: 2, turns: 2 });
    expect(j.estimate.compact.bytes).toBeGreaterThan(0);
    expect(j.estimate.full.bytes).toBeGreaterThan(0);
    expect(j.hits.secret).toBe(1);
    expect(j.warnings.map((w: { code: string }) => w.code)).toContain(
      "sensitive"
    );
    expect(text).not.toContain("done");
    expect(text).not.toContain(secret);
  });
});
