/**
 * Windows Subsystem for Linux. WSL reports itself as Linux, so the few
 * things that differ are keyed off this: the kernel release names Microsoft
 * ("…-microsoft-standard-WSL2"; WSL 1 reads "…-Microsoft"), and WSL sets
 * WSL_DISTRO_NAME in the shells it starts (not under systemd or sudo, so the
 * kernel release comes first). scripts/lib/common.sh `detect_wsl` is the
 * installer's copy of the same test.
 */

import fs from "fs";

export type WslVersion = 0 | 1 | 2;

export function detectWsl(
  osrelease: string | null,
  env: Record<string, string | undefined> = {}
): WslVersion {
  if (osrelease && /microsoft/i.test(osrelease))
    return /wsl2|microsoft-standard/i.test(osrelease) ? 2 : 1;
  // No kernel release to read: the environment can say WSL, not which one.
  return env.WSL_DISTRO_NAME ? 2 : 0;
}

let cached: WslVersion | undefined;

export function wslVersion(): WslVersion {
  if (cached !== undefined) return cached;
  if (process.platform !== "linux") return (cached = 0);
  let osrelease: string | null = null;
  try {
    osrelease = fs.readFileSync("/proc/sys/kernel/osrelease", "utf8");
  } catch {}
  return (cached = detectWsl(osrelease, process.env));
}

// A Windows drive as WSL mounts it (/mnt/c/...). Git, npm and file
// watchers are many times slower there, and inotify doesn't see changes
// made from Windows.
export const onWindowsDrive = (p: string) => /^\/mnt\/[a-z](\/|$)/i.test(p);

export const WINDOWS_DRIVE_WARNING =
  "This folder is on the Windows drive. Git, installs and file watching are slow here under WSL, and changes made from Windows aren't noticed. Keep projects in the Linux home folder (~) instead.";

// Startup notes for the server log, empty off WSL.
export function wslNotes(
  version: WslVersion,
  port: number,
  projectDirs: string[]
): string[] {
  if (!version) return [];
  if (version === 1)
    return [
      "WSL 1 detected: AgentOS supports WSL 2 only (wsl --set-version <distro> 2).",
    ];
  const onDrive = projectDirs.filter(onWindowsDrive);
  return [
    `Running under WSL 2: open AgentOS from Windows at http://localhost:${port} (localhost, not 127.0.0.1, so passkeys work).`,
    ...(onDrive.length
      ? [
          `${onDrive.length} project(s) on the Windows drive, which is slow under WSL and not watched for changes made from Windows: ${onDrive.join(", ")}`,
        ]
      : []),
  ];
}
