import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/artifacts/[id]/route";
import { GET as getImage } from "@/app/api/files/image/route";
import { artifactHeight } from "@/components/Chat/ArtifactFrame";
import { createArtifact } from "./store";

beforeAll(() => {
  process.env.AGENTOS_ARTIFACTS_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentos-artifacts-")
  );
});

const get = (id: string) =>
  GET(new Request(`http://x/api/artifacts/${id}`), {
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
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "agentos-img-"))
    );
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
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "agentos-img-"))
    );
    fs.writeFileSync(path.join(dir, "notes.txt"), "secret");
    fs.symlinkSync(path.join(dir, "notes.txt"), path.join(dir, "x.png"));
    expect((await image(path.join(dir, "notes.txt"))).status).toBe(404);
    expect((await image(path.join(dir, "x.png"))).status).toBe(404);
  });
});
