// Runs after `npm install`. Makes node-pty's spawn helper executable, and on a
// global install says what to run next. npm 7+ hides a script's output unless
// it fails, so the line goes to the terminal itself when there is one. This
// must never fail the install.
import {
  chmodSync,
  closeSync,
  openSync,
  readdirSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

try {
  const prebuilds = join(root, "node_modules/node-pty/prebuilds");
  for (const dir of readdirSync(prebuilds)) {
    try {
      chmodSync(join(prebuilds, dir, "spawn-helper"), 0o755);
    } catch {
      // not every platform has one
    }
  }
} catch {
  // node-pty isn't there (a source checkout with another layout): nothing to do
}

if (process.env.npm_config_global === "true" && !process.env.CI) {
  const text =
    "\nAgentOS is installed. Next, run:  agent-os install\n(it builds the app, starts it and opens it in your browser)\n\n";
  try {
    if (process.env.AGENTOS_POSTINSTALL_NO_TTY) throw new Error("stderr");
    const fd = openSync("/dev/tty", "w");
    writeSync(fd, text);
    closeSync(fd);
  } catch {
    process.stderr.write(text);
  }
}
process.exit(0);
