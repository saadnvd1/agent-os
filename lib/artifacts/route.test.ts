import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/artifacts/[id]/route";
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
