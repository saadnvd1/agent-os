import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { taskOutputTail } from "./task-output";
import { tempDir } from "@/lib/test-temp";

describe("taskOutputTail", () => {
  const dir = tempDir("task-out-");

  it("reads only the end of a big file, with its mtime", () => {
    const file = path.join(dir, "big.output");
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    fs.writeFileSync(file, lines.join("\n") + "\n");
    const when = new Date(Date.now() - 60_000);
    fs.utimesSync(file, when, when);
    const out = taskOutputTail("big", file)!;
    expect(out.text!.length).toBeLessThanOrEqual(6000);
    expect(out.text!.trimEnd().endsWith("line 4999")).toBe(true);
    expect(out.text!.startsWith("line")).toBe(true);
    expect(Math.abs(out.updatedAt! - when.getTime())).toBeLessThan(1000);
  });

  it("returns an empty text for a file with nothing in it yet", () => {
    const file = path.join(dir, "empty.output");
    fs.writeFileSync(file, "");
    expect(taskOutputTail("empty", file)?.text).toBe("");
  });
});
