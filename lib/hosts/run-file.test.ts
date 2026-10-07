import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFileOnTarget } from "./ssh";

const PATH = process.env.PATH;
afterEach(() => {
  process.env.PATH = PATH;
});

describe("runFileOnTarget", () => {
  it("runs a program here directly, arguments untouched", async () => {
    const { stdout } = await runFileOnTarget(null, "printf", [
      "%s|",
      "a b",
      "#{x}",
    ]);
    expect(stdout).toBe("a b|#{x}|");
  });

  it("quotes every argument for the remote shell", async () => {
    // A fake ssh that runs the remote command line with a plain sh.
    const dir = mkdtempSync(join(tmpdir(), "fake-ssh-"));
    writeFileSync(
      join(dir, "ssh"),
      '#!/bin/sh\nfor a; do last=$a; done\nSHELL=/bin/sh exec /bin/sh -c "$last"\n'
    );
    chmodSync(join(dir, "ssh"), 0o755);
    process.env.PATH = `${dir}:${PATH}`;
    const args = [
      "%s|",
      "a b",
      "it's",
      "=s:",
      "#{session_name}\t#{pane_title}",
      "$HOME;x",
    ];
    const { stdout } = await runFileOnTarget("alice@devbox", "printf", args);
    expect(stdout).toBe(
      args
        .slice(1)
        .map((a) => `${a}|`)
        .join("")
    );
  });
});
