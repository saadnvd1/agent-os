import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

let available = true;
const printed: string[] = [];
vi.mock("@/lib/share/pdf", () => ({
  pdfAvailable: async () => available,
  renderPdf: async (html: string) => {
    printed.push(html);
    return Buffer.from("%PDF-1.4 fake");
  },
}));

const pdf = await import("./route");
const preview = await import("../preview/route");
const { saveItem } = await import("@/lib/chat/store");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { MAX_SHARE_BYTES } = await import("@/lib/share/render");

const secret = ["gh", "p_", "b".repeat(36)].join("");

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function chat(extra = "") {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({
    projectId: project.id,
    name: "Share me",
    view: "chat",
  });
  saveItem(id, {
    id: "u1",
    kind: "user",
    text: `key ${secret} keepme`,
    createdAt: 1,
  } as never);
  saveItem(id, {
    id: "a1",
    kind: "assistant",
    text: "```js\nconsole.log(1)\n```" + extra,
    createdAt: 2,
  } as never);
  return id;
}

beforeEach(() => {
  available = true;
  printed.length = 0;
});

describe("POST /api/shares/pdf", () => {
  it("returns a named PDF of the redacted page", async () => {
    const id = chat();
    const res = await pdf.POST(
      post("/api/shares/pdf", { kind: "chat", sessionId: id })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="share-me.pdf"'
    );
    expect(Buffer.from(await res.arrayBuffer()).toString()).toMatch(/^%PDF/);
    expect(printed[0]).toContain("[secret]");
    expect(printed[0]).not.toContain(secret);
  });

  it("prints the same page the preview shows, honouring leave-outs", async () => {
    const id = chat();
    const body = { kind: "chat", sessionId: id, dropIds: ["u1"] };
    const p = await (
      await preview.POST(post("/api/shares/preview", body))
    ).json();
    await pdf.POST(post("/api/shares/pdf", body));
    expect(printed[0]).toBe(p.html);
    expect(printed[0]).not.toContain("keepme");
  });

  it("refuses too-big input, bad bodies and an empty selection", async () => {
    const big = await pdf.POST(
      post("/api/shares/pdf", {
        kind: "chat",
        sessionId: chat("word ".repeat(MAX_SHARE_BYTES / 4)),
      })
    );
    expect(big.status).toBe(413);
    expect((await pdf.POST(post("/api/shares/pdf", {}))).status).toBe(400);
    const id = chat();
    const none = await pdf.POST(
      post("/api/shares/pdf", {
        kind: "chat",
        sessionId: id,
        dropIds: ["u1", "a1"],
      })
    );
    expect(none.status).toBe(400);
    expect(printed).toHaveLength(0);
  });

  it("says 501 with no browser, and preview then omits pdf", async () => {
    const id = chat();
    const body = { kind: "chat", sessionId: id };
    const withBrowser = await (
      await preview.POST(post("/api/shares/preview", body))
    ).json();
    expect(withBrowser.formats).toEqual(["pdf", "html", "md"]);
    available = false;
    expect((await pdf.POST(post("/api/shares/pdf", body))).status).toBe(501);
    const without = await (
      await preview.POST(post("/api/shares/preview", body))
    ).json();
    expect(without.formats).toEqual(["html", "md"]);
  });
});
