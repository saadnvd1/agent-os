/**
 * How a PR merges and what goes after it: the method `gh pr merge` is
 * given, and whether the branch on origin and the local worktree (with its
 * branch) are deleted. Set globally, per project in the UI, or in a
 * project's agentos.json `merge`; the most specific wins:
 * project (UI) > agentos.json > global > default.
 */

import { db, type Project } from "../db";
import { loadProjectConfig } from "../project-config";
import { mergeSettings } from "../project-config/schema";
import { expandHome } from "./session";
import {
  DEFAULT_MERGE_POLICY,
  type MergePolicy,
  type MergeOverride,
  type MergeSettings,
  type MergeSource,
  type ResolvedMergePolicy,
} from "./merge-methods";

export * from "./merge-methods";

const GLOBAL_KEY = "merge";
const projectKey = (projectId: string) => `merge.project.${projectId}`;

function read(key: string): MergeSettings {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  if (!row) return {};
  try {
    const got = mergeSettings.safeParse(JSON.parse(row.value));
    return got.success ? got.data : {};
  } catch {
    return {};
  }
}

// Throws on a bad value; an empty one clears the row.
function write(key: string, settings: unknown): MergeSettings {
  const got = mergeSettings.safeParse(settings ?? {});
  if (!got.success)
    throw new Error(
      `Invalid merge settings: ${got.error.issues
        .map((i) => `${i.path.join(".") || "(top level)"}: ${i.message}`)
        .join("; ")}`
    );
  const parsed = got.data;
  const clean = Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v !== undefined)
  ) as MergeSettings;
  if (!Object.keys(clean).length) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  } else {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, JSON.stringify(clean));
  }
  return clean;
}

export const globalMergeSettings = () => read(GLOBAL_KEY);
export const setGlobalMergeSettings = (s: unknown) => write(GLOBAL_KEY, s);
export const projectMergeSettings = (projectId: string) =>
  read(projectKey(projectId));
export const setProjectMergeSettings = (projectId: string, s: unknown) =>
  write(projectKey(projectId), s);

// What the project's agentos.json says; nothing when it's missing or broken
// (a broken file is reported where it's loaded, not here).
export function configMergeSettings(
  project: Pick<Project, "working_directory">
): MergeSettings {
  const loaded = loadProjectConfig(expandHome(project.working_directory));
  return loaded.error ? {} : (loaded.config.merge ?? {});
}

// `inherited`: what the project would get without its own (UI) setting.
export function mergePolicy(
  project: Pick<Project, "id" | "working_directory"> | null | undefined,
  opts: { inherited?: boolean } = {}
): ResolvedMergePolicy {
  const layers: Array<[MergeSource, MergeSettings]> = [
    ["global", globalMergeSettings()],
    ...(project
      ? ([
          ["agentos.json", configMergeSettings(project)],
          ...(opts.inherited
            ? []
            : [["project", projectMergeSettings(project.id)]]),
        ] as Array<[MergeSource, MergeSettings]>)
      : []),
  ];
  const policy = { ...DEFAULT_MERGE_POLICY };
  const from = {
    method: "default",
    delete_remote_branch: "default",
    delete_worktree: "default",
  } as Record<keyof MergePolicy, MergeSource>;
  for (const [source, layer] of layers) {
    for (const key of Object.keys(from) as Array<keyof MergePolicy>) {
      if (layer[key] === undefined) continue;
      (policy as Record<string, unknown>)[key] = layer[key];
      from[key] = source;
    }
  }
  return { ...policy, from };
}

const hasAny = (s: MergeSettings) =>
  Object.values(s).some((v) => v !== undefined);

// The projects whose own setting or agentos.json overrides the global one.
export function mergeOverrides(
  projects: Array<
    Pick<Project, "id" | "name" | "working_directory" | "is_uncategorized">
  >
): MergeOverride[] {
  return projects.flatMap((p) => {
    if (p.is_uncategorized) return [];
    const project = projectMergeSettings(p.id);
    const config = configMergeSettings(p);
    return hasAny(project) || hasAny(config)
      ? [{ projectId: p.id, name: p.name, project, config }]
      : [];
  });
}
