import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { MAX_NOTE_BYTES } from "@/lib/notes";
import { GET, PUT } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function session() {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'chat', ?, '/tmp')`
    )
    .run(id, `claude-${id}`);
  return id;
}

const put = (id: string, body: unknown) =>
  PUT(
    new Request("http://x", {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx(id)
  );
const get = (id: string) => GET(new Request("http://x"), ctx(id));

const doc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Plan" }],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "ship" }] },
          ],
        },
      ],
    },
  ],
};

describe("/api/sessions/:id/notes", () => {
  it("has no note at first, then round-trips the document", async () => {
    const id = session();
    const empty = await (await get(id)).json();
    expect(empty).toMatchObject({ sessionId: id, doc: null, updatedAt: null });

    const saved = await put(id, { doc });
    expect(saved.status).toBe(200);
    const back = await (await get(id)).json();
    expect(back.doc).toEqual(doc);
    expect(back.updatedAt).toBeTruthy();
  });

  it("last write wins", async () => {
    const id = session();
    await put(id, { doc });
    const second = { type: "doc", content: [{ type: "paragraph" }] };
    await put(id, { doc: second });
    expect((await (await get(id)).json()).doc).toEqual(second);
  });

  it("refuses a note over the size cap and keeps the old one", async () => {
    const id = session();
    await put(id, { doc });
    const big = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x".repeat(MAX_NOTE_BYTES) }],
        },
      ],
    };
    expect((await put(id, { doc: big })).status).toBe(413);
    expect((await (await get(id)).json()).doc).toEqual(doc);
  });

  it("answers 404 for an unknown session", async () => {
    expect((await get("nope")).status).toBe(404);
    expect((await put("nope", { doc })).status).toBe(404);
  });

  it("refuses a body that is not a document", async () => {
    const id = session();
    expect((await put(id, { doc: { type: "paragraph" } })).status).toBe(400);
    expect((await put(id, "{not json")).status).toBe(400);
  });
});
