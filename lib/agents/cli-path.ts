import fs from "fs";
import os from "os";
import path from "path";

// Where agent CLIs install themselves outside a login shell's PATH: a chat
// worker and the server never source ~/.zshrc, so a CLI that lives under nvm
// or its own bin folder is found here instead.
function extraDirs(): string[] {
  const home = os.homedir();
  const nvm = process.env.NVM_DIR || path.join(home, ".nvm");
  let nodeBins: string[] = [];
  try {
    nodeBins = fs
      .readdirSync(path.join(nvm, "versions", "node"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => path.join(nvm, "versions", "node", v, "bin"));
  } catch {
    // No nvm.
  }
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".opencode", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...nodeBins,
  ];
}

function executable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

const found = new Map<string, string | null>();

// The absolute path of a CLI, or null when it isn't installed.
export function resolveCli(name: string, fresh = false): string | null {
  if (!fresh && found.has(name)) return found.get(name)!;
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    ...extraDirs(),
  ];
  const hit = dirs.map((d) => path.join(d, name)).find(executable) ?? null;
  found.set(name, hit);
  return hit;
}

// PATH for a CLI's child processes: its own folder first, so a script whose
// shebang says `node` finds the node it was installed with.
export function pathFor(cli: string): string {
  return [path.dirname(cli), process.env.PATH ?? ""].join(path.delimiter);
}
