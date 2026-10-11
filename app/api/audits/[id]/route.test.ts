import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "audits-route-"));
  process.env.AGENTOS_AUDITS_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.AGENTOS_AUDITS_DIR;
});

const get = (id: string) =>
  GET({} as NextRequest, { params: Promise.resolve({ id }) });

describe("GET /api/audits/<id>", () => {
  it("returns a report by its id", async () => {
    fs.writeFileSync(path.join(dir, "2026-10-10-2000.md"), "# Audit\n");
    const res = await get("2026-10-10-2000");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "2026-10-10-2000",
      markdown: "# Audit\n",
    });
  });

  it("refuses anything that isn't an audit id, and a missing one", async () => {
    fs.writeFileSync(path.join(dir, "secret.md"), "no");
    expect((await get("../secret")).status).toBe(400);
    expect((await get("secret")).status).toBe(400);
    expect((await get("2026-10-10-2001")).status).toBe(404);
  });
});
