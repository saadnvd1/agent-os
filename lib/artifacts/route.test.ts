import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/artifacts/[id]/route";
import { GET as getVersions } from "@/app/api/artifacts/[id]/versions/route";
import { saveItem } from "@/lib/chat/store";
import type { ChatItem } from "@/lib/chat/events";
import type { PageVersions } from "./actions";
import { GET as getImage } from "@/app/api/files/image/route";
import { artifactHeight } from "@/components/Chat/ArtifactFrame";
import { createArtifact } from "./store";
import { tempDir } from "@/lib/test-temp";

beforeAll(() => {
  process.env.AGENTOS_ARTIFACTS_DIR = tempDir("agentos-artifacts-");
});

const get = (id: string, query = "") =>
  GET(new Request(`http://x/api/artifacts/${id}${query}`), {
    params: Promise.resolve({ id }),
  });

const versions = (id: string) =>
  getVersions(new Request(`http://x/api/artifacts/${id}/versions`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/artifacts/[id]", () => {
  it("serves the page sandboxed, never as the app", async () => {
    const a = createArtifact(randomUUID(), "t", "<body><p>hi</p></body>");
    const res = await get(a.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("content-security-policy")).toMatch(
      /^sandbox allow-scripts allow-forms;/
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain("<p>hi</p>");
  });

  it("answers 404 for an unknown or malformed id", async () => {
    expect((await get(randomUUID())).status).toBe(404);
    expect((await get("..%2F..%2Fetc")).status).toBe(404);
  });
});

describe("a page's versions", () => {
  it("serves each version by its id, and the newest with ?v=latest", async () => {
    const session = randomUUID();
    const v1 = createArtifact(session, "t", "<p>one</p>");
    const v2 = createArtifact(session, "t", "<p>two</p>", { update: v1.id });
    expect(await (await get(v1.id)).text()).toContain("one");
    expect(await (await get(v1.id, "?v=latest")).text()).toContain("two");
    expect(await (await get(v2.id, "?v=latest")).text()).toContain("two");
  });

  it("lists every version with its note, size, turn and actions", async () => {
    const session = randomUUID();
    let seq = 0;
    const add = (item: object) =>
      saveItem(session, {
        id: randomUUID(),
        createdAt: ++seq,
        ...item,
      } as ChatItem);
    add({ kind: "user", text: "chart weekly signups" });
    const v1 = createArtifact(session, "Signups", "<p>1</p>");
    add({
      kind: "artifact",
      id: `artifact-${v1.id}`,
      artifactId: v1.id,
      title: "Signups",
    });
    add({ kind: "user", text: "split it by plan" });
    const v2 = createArtifact(session, "Signups", "<p>22</p>", {
      update: v1.id,
      note: "Split by plan",
    });
    add({
      kind: "artifact",
      id: `artifact-${v2.id}`,
      artifactId: v2.id,
      title: "Signups",
    });

    const res = await versions(v1.id);
    expect(res.status).toBe(200);
    const page = (await res.json()) as PageVersions;
    expect(page.pageId).toBe(v1.id);
    expect(page.latestId).toBe(v2.id);
    expect(page.versions).toMatchObject([
      {
        id: v1.id,
        version: 1,
        bytes: 8,
        turn: { index: 1, prompt: "chart weekly signups" },
      },
      {
        id: v2.id,
        version: 2,
        note: "Split by plan",
        bytes: 9,
        turn: { index: 2, prompt: "split it by plan" },
      },
    ]);
    expect(page.versions[0].createdAt).toBeGreaterThan(0);
    expect(page.actions.map((a) => a.id)).toEqual([
      "fullscreen",
      "share",
      "open",
      "download",
    ]);
  });

  it("answers 404 for an unknown page", async () => {
    expect((await versions(randomUUID())).status).toBe(404);
  });
});

describe("the frame's reported height", () => {
  it("takes a finite number, clamped", () => {
    expect(artifactHeight({ agentosArtifactHeight: 300.4 }, 720)).toBe(300);
    expect(artifactHeight({ agentosArtifactHeight: 5000 }, 720)).toBe(720);
    expect(artifactHeight({ agentosArtifactHeight: -10 }, 720)).toBe(80);
  });

  it("ignores anything else", () => {
    for (const data of [
      null,
      "300",
      { agentosArtifactHeight: Infinity },
      { agentosArtifactHeight: NaN },
      { agentosArtifactHeight: "300" },
    ])
      expect(artifactHeight(data, 720)).toBeNull();
  });
});

describe("GET /api/files/image", () => {
  const image = (p: string) =>
    getImage(
      new NextRequest(`http://x/api/files/image?path=${encodeURIComponent(p)}`)
    );

  it("serves an SVG sandboxed, so its scripts never run as the app", async () => {
    const dir = fs.realpathSync(tempDir("agentos-img-"));
    const svg = path.join(dir, "a.svg");
    fs.writeFileSync(svg, "<svg><script>alert(1)</script></svg>");
    const res = await image(svg);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/\bsandbox\b/);
    expect(csp).toMatch(/default-src 'none'/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 404 for anything that isn't an image file", async () => {
    const dir = fs.realpathSync(tempDir("agentos-img-"));
    fs.writeFileSync(path.join(dir, "notes.txt"), "secret");
    fs.symlinkSync(path.join(dir, "notes.txt"), path.join(dir, "x.png"));
    expect((await image(path.join(dir, "notes.txt"))).status).toBe(404);
    expect((await image(path.join(dir, "x.png"))).status).toBe(404);
  });
});
