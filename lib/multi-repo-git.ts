/**
 * Multi-repository git status aggregation
 */

import {
  getGitStatus,
  isGitRepo,
  expandPath,
  type GitFile,
  type GitStatus,
} from "./git-status";
import type { ProjectRepository } from "./db";

/**
 * Extended git file with repository information
 */
export interface MultiRepoGitFile extends GitFile {
  repoId: string;
  repoName: string;
  repoPath: string;
}

/**
 * Repository status information
 */
export interface RepositoryStatus {
  id: string;
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  isValid: boolean;
  error?: string;
}

/**
 * Aggregated multi-repository git status
 */
export interface MultiRepoGitStatus {
  repositories: RepositoryStatus[];
  staged: MultiRepoGitFile[];
  unstaged: MultiRepoGitFile[];
  untracked: MultiRepoGitFile[];
}

/**
 * Get aggregated git status from multiple repositories
 */
export function getMultiRepoGitStatus(
  repositories: ProjectRepository[],
  fallbackPath?: string
): MultiRepoGitStatus {
  const result: MultiRepoGitStatus = {
    repositories: [],
    staged: [],
    unstaged: [],
    untracked: [],
  };

  // If no repositories configured, use fallback path as single repo
  const reposToCheck =
    repositories.length > 0
      ? repositories
      : fallbackPath
        ? [
            {
              id: "fallback",
              project_id: "",
              name: "Repository",
              path: fallbackPath,
              is_primary: true,
              sort_order: 0,
            },
          ]
        : [];

  for (const repo of reposToCheck) {
    const expandedPath = expandPath(repo.path);

    // Check if it's a valid git repo
    if (!isGitRepo(expandedPath)) {
      result.repositories.push({
        id: repo.id,
        name: repo.name,
        path: repo.path,
        branch: "",
        ahead: 0,
        behind: 0,
        isValid: false,
        error: "Not a git repository",
      });
      continue;
    }

    try {
      const status = getGitStatus(expandedPath);

      // Add repository status
      result.repositories.push({
        id: repo.id,
        name: repo.name,
        path: repo.path,
        branch: status.branch,
        ahead: status.ahead,
        behind: status.behind,
        isValid: true,
      });

      // Add files with repo info
      for (const file of status.staged) {
        result.staged.push({
          ...file,
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
        });
      }

      for (const file of status.unstaged) {
        result.unstaged.push({
          ...file,
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
        });
      }

      for (const file of status.untracked) {
        result.untracked.push({
          ...file,
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
        });
      }
    } catch (error) {
      result.repositories.push({
        id: repo.id,
        name: repo.name,
        path: repo.path,
        branch: "",
        ahead: 0,
        behind: 0,
        isValid: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}

/**
 * Group files by repository
 */
export function groupFilesByRepo(
  files: MultiRepoGitFile[]
): Map<string, MultiRepoGitFile[]> {
  const grouped = new Map<string, MultiRepoGitFile[]>();

  for (const file of files) {
    const existing = grouped.get(file.repoId) || [];
    existing.push(file);
    grouped.set(file.repoId, existing);
  }

  return grouped;
}

/**
 * Get repositories with staged changes
 */
export function getReposWithStagedChanges(
  status: MultiRepoGitStatus
): RepositoryStatus[] {
  const repoIds = new Set(status.staged.map((f) => f.repoId));
  return status.repositories.filter((r) => repoIds.has(r.id));
}
