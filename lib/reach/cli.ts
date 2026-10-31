/** Entry for agent-os check (lib/reach/check-cli.ts). Argv: port, then flags. */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { runCheckCli } from "./check-cli";

const [port, ...args] = process.argv.slice(2);
const p = Number(port) || 3011;

const SERVICE_FILES = [
  "Library/LaunchAgents/com.agent-os.plist",
  ".config/systemd/user/agent-os.service",
];

runCheckCli(args, {
  base: `http://127.0.0.1:${p}`,
  fetch,
  out: (line) => console.log(line),
  holder: () =>
    new Promise((resolve) =>
      execFile(
        "lsof",
        ["-nP", `-iTCP:${p}`, "-sTCP:LISTEN", "-Fc"],
        { timeout: 3000 },
        (_err, stdout) =>
          resolve(
            String(stdout ?? "")
              .split("\n")
              .find((l) => l.startsWith("c"))
              ?.slice(1) || null
          )
      )
    ),
  serviceInstalled: () =>
    SERVICE_FILES.some((f) => fs.existsSync(path.join(os.homedir(), f))),
}).then((code) => process.exit(code));
