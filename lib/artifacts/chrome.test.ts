import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { launchChrome } from "./chrome";

describe("launchChrome", () => {
  it("gives up on, and kills, a browser that never answers", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-chrome-"));
    const pidFile = path.join(dir, "pid");
    const stub = path.join(dir, "chrome");
    fs.writeFileSync(
      stub,
      `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`,
      {
        mode: 0o755,
      }
    );
    await expect(launchChrome(stub, 1, 1000)).rejects.toThrow(
      /did not start within 1s/
    );
    // The stub writes its pid at once, well inside the 1s it was given.
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    // Dead once reaped; a zombie still answers signal 0 for a moment.
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), {
      timeout: 3000,
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
