import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateInitScript } from "./banner";
import { getProvider } from "./providers";

const syntaxOk = (script: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "banner-")), "init.sh");
  writeFileSync(file, script);
  execFileSync("bash", ["-n", file]);
};

describe("generateInitScript", () => {
  it("is valid bash for a worker that signs in first", () => {
    const p = getProvider("kiro");
    const script = generateInitScript(`${p.command} chat`, p.preamble);
    expect(script).toContain("&& exec kiro-cli chat");
    syntaxOk(script);
  });

  it("is valid bash for an ordinary provider", () => {
    const p = getProvider("claude");
    const script = generateInitScript(`${p.command} --x`, p.preamble);
    expect(script).toContain("\nexec claude --x");
    syntaxOk(script);
  });
});
