import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getDb } from "./index";

describe("database file", () => {
  it.skipIf(process.platform === "win32")("is owner-only", () => {
    getDb();
    const mode = fs.statSync(process.env.DB_PATH!).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
