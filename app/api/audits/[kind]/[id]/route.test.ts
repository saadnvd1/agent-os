import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { GET as list } from "../../route";
import { GET } from "./route";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "audits-route-"));
  process.env.AGENTOS_AUDITS_DIR = dir;
  fs.mkdirSync(path.join(dir, "sessions"));
  fs.mkdirSync(path.join(dir, "gaps"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.AGENTOS_AUDITS_DIR;
});

const get = (kind: string, id: string) =>
  GET({} as NextRequest, { params: Promise.resolve({ kind, id }) });

describe("GET /api/audits/<kind>/<id>", () => {
  it("returns a session audit's report by its id", async () => {
    fs.writeFileSync(
      path.join(dir, "sessions", "2026-10-10-2000.md"),
      "# Audit\n"
    );
    const res = await get("sessions", "2026-10-10-2000");
    expect(res.status).toBe(200);
    expect((await res.json()).markdown).toBe("# Audit\n");
  });

  it("returns another kind's report without its frontmatter", async () => {
    fs.writeFileSync(
      path.join(dir, "gaps", "2026-10-10.md"),
      "---\naudited: 2026-10-10T20:00:00Z\nkind: gaps\n---\n# Gap audit\nbody\n"
    );
    const res = await get("gaps", "2026-10-10");
    expect((await res.json()).markdown).toBe("# Gap audit\nbody\n");
  });

  it("refuses anything that isn't an audit name, and a missing one", async () => {
    fs.writeFileSync(path.join(dir, "secret.md"), "no");
    expect((await get("sessions", "../secret")).status).toBe(400);
    expect((await get("..", "secret")).status).toBe(400);
    expect((await get("gaps", "README")).status).toBe(400);
    // A sessions report is named by its timestamp id only.
    expect((await get("sessions", "secret")).status).toBe(404);
    expect((await get("sessions", "2026-10-10-2001")).status).toBe(404);
  });
});

describe("GET /api/audits", () => {
  it("lists every kind, newest first, skipping the index README", async () => {
    fs.writeFileSync(
      path.join(dir, "sessions", "index.json"),
      JSON.stringify([
        {
          id: "2026-10-09-2000",
          at: "2026-10-10T01:00:00.000Z",
          since: "",
          until: "",
          sessions: 3,
          tokensRead: 1000,
          headline: "h",
          findings: 2,
          top: [],
        },
      ])
    );
    fs.writeFileSync(
      path.join(dir, "gaps", "2026-10-10.md"),
      "---\naudited: 2026-10-10T20:00:00Z\n---\n# Gap audit\n"
    );
    fs.writeFileSync(path.join(dir, "gaps", "README.md"), "# index\n");
    // A kind's index, by either spelling, isn't an audit.
    fs.mkdirSync(path.join(dir, "other"));
    fs.writeFileSync(path.join(dir, "other", "readme.md"), "# index\n");
    const { audits } = await (await list()).json();
    expect(
      audits.map((a: { kind: string; id: string }) => [a.kind, a.id])
    ).toEqual([
      ["gaps", "2026-10-10"],
      ["sessions", "2026-10-09-2000"],
    ]);
    expect(audits[0].title).toBe("Gap audit");
    expect(audits[1]).toMatchObject({
      sessions: 3,
      findings: 2,
      headline: "h",
    });
  });

  it("shows another kind's headline and finding count from its index", async () => {
    fs.writeFileSync(
      path.join(dir, "gaps", "2026-10-10-2000.md"),
      "---\naudited: 2026-10-10T20:00:00Z\n---\n# Gap audit\n"
    );
    fs.writeFileSync(
      path.join(dir, "gaps", "index.json"),
      JSON.stringify([
        { id: "2026-10-10-2000", headline: "top gap", findings: 4 },
      ])
    );
    const { audits } = await (await list()).json();
    expect(audits).toEqual([
      expect.objectContaining({
        kind: "gaps",
        id: "2026-10-10-2000",
        headline: "top gap",
        findings: 4,
      }),
    ]);
  });
});
