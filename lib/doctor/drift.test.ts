import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { SETUP_COMMANDS } from "../agents/setup-commands";
import type { ProviderId } from "../providers/registry";
import { MIN_NODE_MAJOR } from "./checks";

// The install script and the app each carry their own copy of the Node
// minimum and the agent install lines. They are separate languages, so this
// fails when one is changed without the other.
const read = (...p: string[]) =>
  fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");

describe("install script and app agree", () => {
  it("on the Node minimum", () => {
    const sh = read("scripts", "lib", "prerequisites.sh");
    const majors = [
      ...[...sh.matchAll(/"\$version" -ge (\d+)/g)].map((m) => Number(m[1])),
      ...[...sh.matchAll(/node (\d+)\+/g)].map((m) => Number(m[1])),
      ...[...sh.matchAll(/Node\.js (\d+)\+/g)].map((m) => Number(m[1])),
    ];
    expect(majors.length).toBeGreaterThanOrEqual(3);
    for (const m of majors) expect(m).toBe(MIN_NODE_MAJOR);
    const engines = JSON.parse(read("package.json")).engines.node as string;
    expect(engines).toBe(`>=${MIN_NODE_MAJOR}`);
  });

  it("on the install command of each agent CLI both cover", () => {
    const lines = read("scripts", "lib", "ai-clis.sh").split("\n");
    // What names each CLI in the script.
    const marker: Partial<Record<ProviderId, string>> = {
      claude: "claude.ai/install.sh",
      codex: "@openai/codex",
      gemini: "@google/gemini-cli",
      kilocode: "@kilocode/cli",
    };
    let covered = 0;
    for (const [id, key] of Object.entries(marker)) {
      const install = SETUP_COMMANDS[id as ProviderId]?.install;
      expect(install, `${id} has an install line`).toBeTruthy();
      const mentions = lines.filter((l) => l.includes(key!));
      expect(mentions.length, `${id} is in ai-clis.sh`).toBeGreaterThan(0);
      expect(
        mentions.some((l) => l.includes(install!)),
        `${id}: ai-clis.sh and setup-commands.ts install differently`
      ).toBe(true);
      covered++;
    }
    expect(covered).toBe(4);
  });
});
