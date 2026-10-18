import fs from "fs";
import os from "os";
import path from "path";

// Where Saad's language version managers and user-level tools put their
// binaries, in the order they should win. A shell's rc files normally add
// these; a session AgentOS starts doesn't read them, so `bin/rails` would
// find the system Ruby. Built in code so it is fast and the same on the Mac
// and the Linux box (missing dirs are skipped).
const USER_TOOL_DIRS = [
  ".rbenv/shims",
  ".local/share/mise/shims",
  ".asdf/shims",
  ".pyenv/shims",
  ".local/bin",
  ".bun/bin",
  ".cargo/bin",
];
const SYSTEM_TOOL_DIRS = ["/opt/homebrew/bin", "/opt/homebrew/sbin"];

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// `npm run` puts every node_modules/.bin from the server's directory upward on
// PATH; for a session in another repo those would shadow the project's tools.
function serverBinDirs(cwd: string): Set<string> {
  const dirs = new Set<string>();
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    dirs.add(path.join(d, "node_modules", ".bin"));
    if (path.dirname(d) === d) break;
  }
  return dirs;
}

export function sessionPath(
  inherited: string | undefined = process.env.PATH,
  home: string = os.homedir(),
  cwd: string = process.cwd()
): string {
  const drop = serverBinDirs(cwd);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    out.push(dir);
  };
  for (const d of [
    ...USER_TOOL_DIRS.map((d) => path.join(home, d)),
    ...SYSTEM_TOOL_DIRS,
  ])
    if (isDir(d)) add(d);
  for (const d of (inherited ?? "").split(path.delimiter))
    if (!drop.has(d)) add(d);
  return out.join(path.delimiter);
}
