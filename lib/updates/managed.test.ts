import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { tempDir } from "@/lib/test-temp";
import { autodeployManaged, MANAGED_FRESH_MS } from "./managed";

let dir: string;
let file: string;
const here = { host: "box", cwd: "/repo" };
const beat = (host: string, cwd: string, ageMs = 0) => {
  fs.writeFileSync(file, `${host}\n${cwd}\n`);
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
};

beforeEach(() => {
  dir = tempDir("aos-managed-");
  file = path.join(dir, "heartbeat");
});

describe("autodeployManaged", () => {
  it("is true for a fresh beat from this host and checkout", () => {
    beat("box", "/repo");
    expect(autodeployManaged(file, here)).toBe(true);
  });
  it("is false with no heartbeat", () => {
    expect(autodeployManaged(file, here)).toBe(false);
  });
  it("is false for a stale beat", () => {
    beat("box", "/repo", MANAGED_FRESH_MS + 1000);
    expect(autodeployManaged(file, here)).toBe(false);
  });
  it("is false for another checkout's path", () => {
    beat("box", "/other");
    expect(autodeployManaged(file, here)).toBe(false);
  });
  it("is false for another machine's beat", () => {
    beat("mac", "/repo");
    expect(autodeployManaged(file, here)).toBe(false);
  });
  it("is false for a beat from the future", () => {
    beat("box", "/repo", -10 * 60_000);
    expect(autodeployManaged(file, here)).toBe(false);
  });
  it("is false for a bare touched file", () => {
    fs.writeFileSync(file, "");
    expect(autodeployManaged(file, here)).toBe(false);
  });
});
