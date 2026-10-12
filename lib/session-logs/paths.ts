import fs from "fs";
import os from "os";
import path from "path";
import { getProject, getProjectRepositories } from "../projects";

export const expand = (p: string) =>
  p === "~" ? os.homedir() : p.replace(/^~(?=\/)/, os.homedir());

// The path with symlinks resolved as far as it exists, so a link into a
// repository is seen for what it is.
export function resolved(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) break;
    rest.unshift(path.basename(cur));
    cur = up;
  }
  return path.join(fs.realpathSync(cur), ...rest);
}

export const within = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export function repoPaths(projectId: string): string[] {
  const project = getProject(projectId);
  if (!project) return [];
  return [
    project.working_directory,
    ...getProjectRepositories(projectId).map((r) => r.path),
  ]
    .filter(Boolean)
    .map((p) => resolved(expand(p)));
}
