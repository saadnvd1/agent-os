import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Ask } from "./summarize";

// Haiku on the machine's own Claude subscription, no key. Run from an empty
// folder with no tools, no skills and no saved session so it reads nothing
// but the prompt.
export function haikuArgs(system: string): string[] {
  return [
    "-p",
    "--model",
    "haiku",
    // One argv entry, so the empty list can't be swallowed by the variadic flag.
    "--tools=",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--system-prompt",
    system,
  ];
}

// The CLI's own words, not execFile's "Command failed: <whole argv>".
export function haikuError(err: Error, stderr: string, stdout: string): Error {
  const line = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean);
  const why = line(stderr) ?? line(stdout) ?? err.message.split("\n")[0];
  return new Error(`claude -p failed: ${why.slice(0, 300)}`);
}

export const askHaiku: Ask = (system, prompt) =>
  new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aos-whats-new-"));
    const child = execFile(
      "claude",
      haikuArgs(system),
      { cwd, timeout: 180_000, maxBuffer: 4 << 20 },
      (err, stdout, stderr) => {
        fs.rmSync(cwd, { recursive: true, force: true });
        if (err) reject(haikuError(err, stderr, stdout));
        else resolve(stdout);
      }
    );
    child.stdin?.end(prompt);
  });
