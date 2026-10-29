/**
 * Tells the "/" menu where each command or skill comes from: the project's
 * own folders, the user's, a plugin (its name carries the plugin as a
 * "plugin:" prefix), or the agent itself.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { SKILL_DIRS } from "../agents/skill-dirs";
import type { ChatCommand } from "./events";

const claudeDir = () =>
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

function entries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const isDir = (e: fs.Dirent, dir: string) =>
  e.isDirectory() ||
  (e.isSymbolicLink() && fs.statSync(path.join(dir, e.name)).isDirectory());

// The name in a SKILL.md's frontmatter, when it differs from the folder.
function declaredName(file: string): string | null {
  try {
    const head = fs.readFileSync(file, "utf8").slice(0, 1024);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1] ?? "";
    return /^name:\s*["']?([^\s"']+)/m.exec(fm)?.[1] ?? null;
  } catch {
    return null;
  }
}

// Names a folder of skills and commands offers: skill folders, and command
// files (nested ones as "dir:name").
export function namesIn(root: string): Set<string> {
  const names = new Set<string>();
  const skills = path.join(root, "skills");
  for (const e of entries(skills)) {
    try {
      if (!isDir(e, skills)) continue;
    } catch {
      continue;
    }
    names.add(e.name);
    const declared = declaredName(path.join(skills, e.name, "SKILL.md"));
    if (declared) names.add(declared);
  }
  const commands = path.join(root, "commands");
  const walk = (dir: string, prefix: string) => {
    for (const e of entries(dir)) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}:`);
      else if (e.name.endsWith(".md"))
        names.add(`${prefix}${e.name.slice(0, -3)}`);
    }
  };
  walk(commands, "");
  return names;
}

function projectNames(cwd: string): Set<string> {
  const names = new Set<string>();
  const home = os.homedir();
  // The folder and its parents, up to home: a repo's skills reach its subfolders.
  for (let dir = cwd; dir !== home && dir !== path.dirname(dir);) {
    for (const rel of SKILL_DIRS) {
      // SKILL_DIRS are ".claude/skills" style; namesIn wants the parent.
      for (const n of namesIn(path.join(dir, path.dirname(rel)))) names.add(n);
    }
    dir = path.dirname(dir);
  }
  return names;
}

export function tagSources(
  commands: ChatCommand[],
  cwd: string
): ChatCommand[] {
  const project = projectNames(cwd);
  const user = namesIn(claudeDir());
  return commands.map((c) => {
    if (project.has(c.name)) return { ...c, source: "project" };
    if (user.has(c.name)) return { ...c, source: "global" };
    if (c.builtin) return { ...c, source: "builtin" };
    const colon = c.name.indexOf(":");
    if (colon > 0)
      return { ...c, source: "plugin", plugin: c.name.slice(0, colon) };
    return { ...c, source: "builtin" };
  });
}
