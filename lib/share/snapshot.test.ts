import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import type { ShareContext } from "./redact";
import { tempDir } from "@/lib/test-temp";

process.env.AGENTOS_ARTIFACTS_DIR = tempDir("agentos-share-art-");
const { saveItem } = await import("@/lib/chat/store");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { createArtifact } = await import("@/lib/artifacts/store");
const { buildChatSnapshot, buildArtifactSnapshot, visible } =
  await import("./snapshot");

const secret = ["gh", "p_", "a".repeat(36)].join("");
const ctx: ShareContext = {
  home: "/Users/" + "fakeuser",
  user: "fakeuser",
  secrets: [],
  hosts: [],
};

function chat() {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  return seedSession({ projectId: project.id, name: "My chat", view: "chat" });
}
let n = 0;
const at = () => ++n;
const add = (id: string, item: Record<string, unknown>) =>
  saveItem(id, { createdAt: at(), ...item } as ChatItem);

function seeded() {
  const id = chat();
  add(id, {
    id: "u1",
    kind: "user",
    text: `hi, token ${secret}`,
    images: [{}],
  });
  add(id, {
    id: "t1",
    kind: "tool",
    name: "Bash",
    title: "ls",
    input: { command: "ls" },
    status: "done",
    output: "a b",
  });
  add(id, { id: "r1", kind: "reasoning", text: "thinking about it" });
  add(id, { id: "a1", kind: "assistant", text: `see ${ctx.home}/app` });
  add(id, { id: "n1", kind: "note", text: "orchestrator note", tone: "note" });
  add(id, { id: "e1", kind: "turn_end" });
  return id;
}

describe("buildChatSnapshot", () => {
  it("leaves out tool calls and thinking by default, and what is never shared", async () => {
    const id = seeded();
    const s = await buildChatSnapshot(id, ctx, { includeTools: false });
    expect(s.items.map((i) => i.id)).toEqual(["u1", "a1"]);
    expect(s.toolsHidden).toBe(true);
  });

  it("includes tool calls and thinking when asked", async () => {
    const id = seeded();
    const s = await buildChatSnapshot(id, ctx, { includeTools: true });
    expect(s.items.map((i) => i.id)).toEqual(["u1", "t1", "r1", "a1"]);
  });

  it("redacts text, turns images into placeholders and counts what it masked", async () => {
    const id = seeded();
    const s = await buildChatSnapshot(id, ctx, { includeTools: false });
    const all = JSON.stringify(s);
    expect(all).not.toContain(secret);
    expect(all).not.toContain(ctx.home);
    expect(s.items[0].text).toContain("[image not shared]");
    expect(s.hits.secret).toBe(1);
    expect(s.hits.path).toBe(1);
  });

  it("leaves out the messages the reader dropped", async () => {
    const id = seeded();
    const s = await buildChatSnapshot(id, ctx, {
      includeTools: true,
      dropIds: ["u1", "r1"],
    });
    expect(s.items.map((i) => i.id)).toEqual(["t1", "a1"]);
    expect(s.hits.secret).toBe(0);
  });

  it("shares only the range, and says what was cut on each side", async () => {
    const id = seeded();
    const s = await buildChatSnapshot(id, ctx, {
      includeTools: true,
      fromId: "t1",
      toId: "r1",
    });
    expect(s.items.map((i) => i.id)).toEqual(["t1", "r1"]);
    expect(s.cutBefore).toBe(true);
    expect(s.cutAfter).toBe(true);
    expect(s.items[0].createdAt).toBeGreaterThan(0);
  });

  it("marks only the side that was cut, and nothing for a full range", async () => {
    const id = seeded();
    const tail = await buildChatSnapshot(id, ctx, {
      includeTools: false,
      fromId: "a1",
    });
    expect(tail.items.map((i) => i.id)).toEqual(["a1"]);
    expect([tail.cutBefore, tail.cutAfter]).toEqual([true, false]);
    const whole = await buildChatSnapshot(id, ctx, {
      includeTools: false,
      fromId: "u1",
      toId: "a1",
    });
    expect([whole.cutBefore, whole.cutAfter]).toEqual([false, false]);
  });

  it("doesn't call tool rows hidden outside the range a cut", async () => {
    const id = seeded();
    const s = await buildChatSnapshot(id, ctx, {
      includeTools: false,
      fromId: "a1",
      toId: "a1",
    });
    expect(s.cutBefore).toBe(true);
    const head = await buildChatSnapshot(id, ctx, {
      includeTools: false,
      fromId: "u1",
      toId: "u1",
    });
    expect([head.cutBefore, head.cutAfter]).toEqual([false, true]);
  });

  it("applies the dropped messages inside the range", async () => {
    const id = seeded();
    const s = await buildChatSnapshot(id, ctx, {
      includeTools: true,
      fromId: "t1",
      dropIds: ["r1", "u1"],
    });
    expect(s.items.map((i) => i.id)).toEqual(["t1", "a1"]);
  });

  it("refuses a range that names a message that isn't there", async () => {
    const id = seeded();
    await expect(
      buildChatSnapshot(id, ctx, { includeTools: false, fromId: "gone" })
    ).rejects.toThrow(/pick the range again/);
    await expect(
      buildChatSnapshot(id, ctx, {
        includeTools: false,
        fromId: "a1",
        toId: "u1",
      })
    ).rejects.toThrow();
  });

  it("hides the output of a tool that read a secret file", async () => {
    const id = chat();
    const body = "DB_HOST=db.internal";
    add(id, {
      id: "t1",
      kind: "tool",
      name: "Read",
      title: "Read .env",
      input: { file_path: "/srv/app/.env" },
      status: "done",
      output: body,
    });
    const s = await buildChatSnapshot(id, ctx, { includeTools: true });
    expect(s.items[0].text).toContain("secret file hidden");
    expect(s.items[0].text).not.toContain(body);
  });

  it("drops what an undo took back", () => {
    const items = [
      { id: "u1", kind: "user", text: "a" },
      { id: "u2", kind: "user", text: "b" },
      { id: "x", kind: "undo", from: "u2", filesChanged: 0 },
      { id: "u3", kind: "user", text: "c" },
    ] as unknown as ChatItem[];
    expect(visible(items).map((i) => i.id)).toEqual(["u1", "u3"]);
  });

  it("embeds and redacts an artifact in the chat", async () => {
    const id = chat();
    const art = createArtifact(id, "Report", `<p>${secret}</p>`);
    add(id, {
      id: "art1",
      kind: "artifact",
      artifactId: art.id,
      title: "Report",
    });
    const s = await buildChatSnapshot(id, ctx, { includeTools: false });
    expect(s.items[0].type).toBe("artifact");
    expect(s.items[0].html).toBe("<p>[secret]</p>");
  });
});

describe("buildArtifactSnapshot", () => {
  it("redacts the page and its title", async () => {
    const id = chat();
    const art = createArtifact(
      id,
      `at ${ctx.home}`,
      `<p>${secret} ${ctx.home}</p>`
    );
    const s = await buildArtifactSnapshot(art.id, ctx);
    expect(s?.html).toBe("<p>[secret] ~</p>");
    expect(s?.title).toBe("at ~");
  });
  it("is null for a page that isn't there", async () => {
    expect(await buildArtifactSnapshot(randomUUID(), ctx)).toBeNull();
  });
});
