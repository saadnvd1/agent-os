import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Ask } from "./summarize";

// Haiku on the machine's own Claude subscription, no key. Run from an empty
// folder with no tools, no skills and no saved session so it reads nothing
// but the prompt.
export const askHaiku: Ask = (system, prompt) =>
  new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aos-whats-new-"));
    const child = execFile(
      "claude",
      [
        "-p",
        "--model",
        "haiku",
        "--tools",
        "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--system-prompt",
        system,
      ],
      { cwd, timeout: 180_000, maxBuffer: 4 << 20 },
      (err, stdout) => {
        fs.rmSync(cwd, { recursive: true, force: true });
        if (err) reject(err);
        else resolve(stdout);
      }
    );
    child.stdin?.end(prompt);
  });
