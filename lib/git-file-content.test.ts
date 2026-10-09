import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/git/file-content/route";

// The file name is a git revision argument, never shell text.
describe("GET /api/git/file-content", () => {
  it("never runs a file name as a command", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-content-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
    const marker = path.join(dir, "ran");
    const ask = (file: string) =>
      GET(
        new NextRequest(
          `http://x/api/git/file-content?path=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`
        )
      ).then((r) => r.json());

    expect(await ask("a.txt")).toEqual({ content: "hello\n" });
    expect(await ask(`$(touch ${marker})`)).toMatchObject({ isNew: true });
    expect(await ask(`x"; touch ${marker}; "`)).toMatchObject({ isNew: true });
    expect(fs.existsSync(marker)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
