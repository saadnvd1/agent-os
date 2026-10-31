import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

// `agent-os setup` and the service commands against a fake $HOME. launchctl,
// systemctl, curl and the TypeScript entry points are fakes that record what
// they were asked; the server is "up" once a file exists.
const LIB = join(import.meta.dirname);
const TOOLS = [
  "tr",
  "cat",
  "sed",
  "head",
  "grep",
  "mkdir",
  "id",
  "mktemp",
  "cp",
  "rm",
  "dirname",
  "realpath",
  "ps",
  "stat",
  "mv",
  "touch",
  "nohup",
];

let dir: string;

function fake(name: string, body: string) {
  const p = join(dir, "bin", name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}
const calls = () =>
  existsSync(join(dir, "calls.log"))
    ? readFileSync(join(dir, "calls.log"), "utf8")
    : "";
const plist = () => join(dir, "Library/LaunchAgents/com.agent-os.plist");
const unit = () => join(dir, ".config/systemd/user/agent-os.service");
const script = () => join(dir, "agent-os");

function run(command: string, os = "macos") {
  return spawnSync(
    "/bin/bash",
    [
      "-euo",
      "pipefail",
      "-c",
      [
        `source "${LIB}/common.sh"`,
        `source "${LIB}/prerequisites.sh"`,
        `source "${LIB}/commands.sh"`,
        `source "${LIB}/setup.sh"`,
        `BOLD=""; OS=${os} WSL=0 PORT=3011 AGENT_OS_HOME="${dir}" REPO_DIR="${dir}/repo"`,
        `PID_FILE="${dir}/agent-os.pid" LOG_FILE="${dir}/agent-os.log" SCRIPT_DIR="${LIB}"`,
        `has_systemd() { [[ "$OS" != macos ]]; }`,
        `enable_linger() { echo "linger" >> "${dir}/calls.log"; }`,
        `aos_tsx() { echo "tsx $*" >> "${dir}/calls.log"; return "$(cat "${dir}/check-exit" 2>/dev/null || echo 0)"; }`,
        command,
      ].join("; "),
      script(),
    ],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: join(dir, "bin"),
        HOME: dir,
        USER: "tester",
        NODE_ENV: "test",
      },
    }
  );
}

beforeEach(() => {
  dir = tempDir("aos-setup-");
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "repo/.next"), { recursive: true });
  writeFileSync(join(dir, "repo/.next/BUILD_ID"), "x");
  writeFileSync(script(), "");
  for (const tool of [...TOOLS, "node"]) {
    const real =
      tool === "node"
        ? process.execPath
        : ["/usr/bin", "/bin"].map((d) => join(d, tool)).find(existsSync);
    if (real) symlinkSync(real, join(dir, "bin", tool));
  }
  fake("sleep", "true");
  // launchctl: print succeeds once bootstrapped; bootstrap starts the server.
  fake(
    "launchctl",
    `echo "launchctl $*" >> "${dir}/calls.log"
case "$1" in
  print) [ -f "${dir}/loaded" ];;
  bootstrap) [ -f "${dir}/no-gui" ] && exit 5; touch "${dir}/loaded" "${dir}/up";;
  bootout) rm -f "${dir}/loaded" "${dir}/up";;
  kickstart) touch "${dir}/up";;
esac`
  );
  fake(
    "systemctl",
    `echo "systemctl $*" >> "${dir}/calls.log"
case "$*" in *is-enabled*|*is-active*) exit 1;; esac`
  );
  fake(
    "curl",
    `for a in "$@"; do last="$a"; done
case "$*" in
  *"-X PUT"*) echo "curl PUT $last" >> "${dir}/calls.log"; exit 0;;
esac
[ -f "${dir}/up" ] || exit 7
case "$last" in
  */api/health) echo '{"ok":true,"startedAt":"2026-10-31T12:00:00Z"}';;
  */api/devices/network) cat "${dir}/net.json" 2>/dev/null || echo '{}';;
esac`
  );
  // Stays up a moment, as a server would, for cmd_start's liveness check.
  fake(
    "npm",
    `echo "npm $*" >> "${dir}/calls.log"; touch "${dir}/up"; exec /bin/sleep 1`
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PLIST = (
  s: string,
  log: string
) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-os</string>
    <key>ProgramArguments</key>
    <array>
        <string>${s}</string>
        <string>start-foreground</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>AbandonProcessGroup</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${log}</string>
    <key>StandardErrorPath</key>
    <string>${log}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;

// What `agent-os enable` wrote before this change, byte for byte.
const UNIT = (s: string) => `[Unit]
Description=AgentOS - AI Coding Session Manager
After=network.target

[Service]
Type=simple
ExecStart=${s} start-foreground
Restart=on-failure
RestartSec=10
# Only the server is stopped on a restart: terminals (tmux), chat workers and
# an update in progress outlive it, as they do under launchd.
KillMode=process
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;

const setup = (args = "--yes --via lan --no-pair") => run(`cmd_setup ${args}`);
const realScript = () => run(`realpath "$0"`).stdout.trim();

describe("agent-os setup", () => {
  it("installs the service, turns on Wi-Fi access and runs the check", () => {
    const r = setup();
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(plist(), "utf8")).toBe(
      PLIST(realScript(), join(dir, "agent-os.log"))
    );
    const log = calls();
    expect(log).toMatch(
      /launchctl bootout gui\/\d+\/com\.agent-os\nlaunchctl bootstrap gui\/\d+ /
    );
    expect(log).not.toMatch(/launchctl (load|unload)/);
    expect(log).toContain("curl PUT http://127.0.0.1:3011/api/devices/network");
    expect(log).toContain("tsx lib/reach/cli.ts 3011 --via lan");
  });

  it("a second run changes nothing", () => {
    setup();
    writeFileSync(join(dir, "net.json"), '{"lan":{"on":true}}');
    rmSync(join(dir, "calls.log"));
    const r = setup();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(
      "Starts at login and restarts after a crash (already done)"
    );
    expect(r.stdout).toContain(
      "Devices on this Wi-Fi can connect (already done)"
    );
    expect(calls()).not.toMatch(/bootstrap|bootout|PUT/);
  });

  it("never overwrites a service file you changed under --yes", () => {
    mkdirSync(join(dir, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(plist(), "<plist>mine</plist>\n");
    const r = setup();
    expect(r.stdout).toContain("Kept yours");
    expect(readFileSync(plist(), "utf8")).toBe("<plist>mine</plist>\n");
    expect(calls()).not.toContain("bootstrap");
  });

  it("leaves a server started some other way alone", () => {
    writeFileSync(join(dir, "up"), "");
    const r = setup();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("started some other way");
    expect(existsSync(plist())).toBe(false);
    expect(calls()).not.toContain("launchctl bootstrap");
  });

  it("stops at the check's failure, and says to run it again", () => {
    writeFileSync(join(dir, "check-exit"), "2");
    const r = setup();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Run 'agent-os setup' again");
    expect(r.stdout).not.toContain("5. Your phone");
  });

  it("carries on without launchd when there's no desktop session (ssh)", () => {
    writeFileSync(join(dir, "no-gui"), "");
    const r = setup();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("no-gui-session");
    expect(calls()).toContain("npm start");
  });

  it("refuses --via with nothing after it", () => {
    const r = run("cmd_setup --via");
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toContain(
      "--via takes connect, tailscale or lan"
    );
  });

  it("refuses an unknown route", () => {
    const r = setup("--via carrier-pigeon");
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toContain(
      "--via takes connect, tailscale or lan"
    );
  });
});

describe("the service file", () => {
  it("systemd: the same unit as before, byte for byte", () => {
    expect(run(`render_systemd_unit "$(realpath "$0")"`, "debian").stdout).toBe(
      UNIT(realScript())
    );
  });

  it("reconcile: installed, then unchanged", () => {
    expect(run("service_reconcile").stdout.trim()).toBe("installed");
    expect(run("service_reconcile").stdout.trim()).toBe("unchanged");
  });

  it("reconcile: the old plist is ours and gets updated", () => {
    mkdirSync(join(dir, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(
      plist(),
      run(`render_launchd_plist_v1 "$(realpath "$0")"`).stdout
    );
    expect(run("service_file_state").stdout.trim()).toBe("older");
    expect(run("service_reconcile keep").stdout.trim()).toBe("updated");
    expect(readFileSync(plist(), "utf8")).toContain(
      "<string>start-foreground</string>"
    );
  });

  it("reconcile: an edited file is kept under keep", () => {
    mkdirSync(join(dir, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(plist(), "edited\n");
    expect(run("service_reconcile keep").stdout.trim()).toBe("kept-yours");
    expect(readFileSync(plist(), "utf8")).toBe("edited\n");
  });

  it("reconcile: an edited file that is replaced is kept as .bak", () => {
    mkdirSync(join(dir, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(plist(), "edited\n");
    const r = run("service_reconcile");
    expect(r.stdout.trim()).toBe("updated");
    expect(readFileSync(`${plist()}.bak`, "utf8")).toBe("edited\n");
    expect(readFileSync(plist(), "utf8")).toContain("start-foreground");
  });

  it("enable on an edited systemd unit keeps a copy of it", () => {
    mkdirSync(join(dir, ".config/systemd/user"), { recursive: true });
    writeFileSync(unit(), "[Service]\nExecStart=/mine\n");
    const r = run("cmd_enable", "debian");
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(`${unit()}.bak`, "utf8")).toBe(
      "[Service]\nExecStart=/mine\n"
    );
    expect(readFileSync(unit(), "utf8")).toBe(UNIT(realScript()));
  });

  it("paths with odd characters stay one value in both files", () => {
    const odd = "/Users/a b/R&D <x>/100%/agent-os";
    const xml = run(`render_launchd_plist "${odd}"`).stdout;
    expect(xml).toContain(
      "<string>/Users/a b/R&amp;D &lt;x&gt;/100%/agent-os</string>"
    );
    const systemd = run(`render_systemd_unit '${odd}'`, "debian").stdout;
    expect(systemd).toContain(
      'ExecStart="/Users/a b/R&D <x>/100%%/agent-os" start-foreground'
    );
    expect(run(`render_systemd_unit '/a/"q"\\b c'`, "debian").stdout).toContain(
      'ExecStart="/a/\\"q\\"\\\\b c" start-foreground'
    );
  });

  it("systemd: enable writes the unit and enables it", () => {
    const r = run("cmd_enable", "debian");
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(unit(), "utf8")).toBe(UNIT(realScript()));
    expect(calls()).toContain("systemctl --user enable agent-os");
  });
});

describe("launchd commands", () => {
  it("stop boots it out, restart kickstarts it, disable boots out and removes it", () => {
    run("cmd_enable");
    rmSync(join(dir, "calls.log"));
    run("cmd_restart");
    expect(calls()).toMatch(/launchctl kickstart -k gui\/\d+\/com\.agent-os/);
    run("cmd_stop");
    expect(calls()).toMatch(/launchctl bootout gui\/\d+\/com\.agent-os/);
    run("cmd_start");
    expect(calls()).toMatch(
      /launchctl bootstrap gui\/\d+ .*com\.agent-os\.plist/
    );
    run("cmd_disable");
    expect(existsSync(plist())).toBe(false);
    expect(calls()).not.toMatch(/launchctl (load|unload)/);
  });

  it("start with the agent loaded but the server gone never kills one that's running", () => {
    run("cmd_enable");
    rmSync(join(dir, "up"));
    rmSync(join(dir, "calls.log"));
    const r = run("cmd_start");
    expect(r.status, r.stderr).toBe(0);
    expect(calls()).toMatch(/launchctl kickstart gui\/\d+\/com\.agent-os/);
    expect(calls()).not.toContain("kickstart -k");
  });

  it("enable twice: the second is a no-op", () => {
    run("cmd_enable");
    rmSync(join(dir, "calls.log"));
    const r = run("cmd_enable");
    expect(r.stdout).toContain("already enabled");
    expect(calls()).not.toMatch(/bootstrap|bootout/);
  });
});
