/**
 * The merge methods and their names, safe to import in the browser. The
 * settings themselves are read in merge-policy.ts.
 */

export const MERGE_METHODS = ["squash", "merge", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];
// What a setting layer says; agentos.json's `merge` (schema.ts) is this.
export interface MergeSettings {
  method?: MergeMethod;
  delete_remote_branch?: boolean;
  delete_worktree?: boolean;
}
export type MergePolicy = Required<MergeSettings>;
export type MergeSource = "default" | "global" | "agentos.json" | "project";

export interface ResolvedMergePolicy extends MergePolicy {
  from: Record<keyof MergePolicy, MergeSource>;
}

export const DEFAULT_MERGE_POLICY: MergePolicy = {
  method: "squash",
  delete_remote_branch: true,
  delete_worktree: true,
};

export const MERGE_FLAG: Record<MergeMethod, string> = {
  squash: "--squash",
  merge: "--merge",
  rebase: "--rebase",
};

// "PR #7 squash-merged at abc1234".
export const MERGED_AS: Record<MergeMethod, string> = {
  squash: "squash-merged",
  merge: "merged with a merge commit",
  rebase: "rebase-merged",
};

// The repository setting that allows each method, as GitHub labels it.
export const REPO_SETTING: Record<MergeMethod, string> = {
  squash: "Allow squash merging",
  merge: "Allow merge commits",
  rebase: "Allow rebase merging",
};

export const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: "squash",
  merge: "merge commit",
  rebase: "rebase",
};

export interface MergeOverride {
  projectId: string;
  name: string;
  // Only the fields each level sets.
  project: MergeSettings;
  config: MergeSettings;
}
