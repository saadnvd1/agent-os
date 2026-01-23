import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gitKeys } from "./keys";

// Re-export for convenience
export { gitKeys };
import type { CommitSummary, CommitDetail } from "@/lib/git-history";
import type { GitStatus } from "@/lib/git-status";
import type { MultiRepoGitStatus } from "@/lib/multi-repo-git";
import type { ProjectRepository } from "@/lib/db";

export interface PRInfo {
  number: number;
  url: string;
  state: string;
  title: string;
}

export interface PRData {
  branch: string;
  baseBranch: string;
  existingPR: PRInfo | null;
  commits: { hash: string; subject: string }[];
  suggestedTitle: string;
  suggestedBody: string;
}

// --- Git Status ---

async function fetchGitStatus(workingDir: string): Promise<GitStatus> {
  const res = await fetch(
    `/api/git/status?path=${encodeURIComponent(workingDir)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function useGitStatus(
  workingDir: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: gitKeys.status(workingDir),
    queryFn: () => fetchGitStatus(workingDir),
    staleTime: 10000, // Consider fresh for 10s
    refetchInterval: 15000, // Poll every 15s (was 3s)
    enabled: !!workingDir && (options?.enabled ?? true),
  });
}

// --- PR Status ---

async function fetchPRData(workingDir: string): Promise<PRData | null> {
  const res = await fetch(`/api/git/pr?path=${encodeURIComponent(workingDir)}`);
  const data = await res.json();
  if (data.error) return null;
  return data;
}

export function usePRStatus(workingDir: string) {
  return useQuery({
    queryKey: gitKeys.pr(workingDir),
    queryFn: () => fetchPRData(workingDir),
    staleTime: 60000, // 1 minute - PR status doesn't change often
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    enabled: !!workingDir,
  });
}

// --- Mutations ---

export function useCreatePR(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // First get suggested content (with generate=true for AI generation)
      const infoRes = await fetch(
        `/api/git/pr?path=${encodeURIComponent(workingDir)}&generate=true`
      );
      const info = await infoRes.json();

      if (info.error) throw new Error(info.error);

      if (info.existingPR) {
        // PR already exists, just return it
        return { pr: info.existingPR, created: false };
      }

      // Create the PR with auto-generated content
      const createRes = await fetch("/api/git/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDir,
          title: info.suggestedTitle,
          description: info.suggestedBody,
          baseBranch: info.baseBranch,
        }),
      });

      const result = await createRes.json();
      if (result.error) throw new Error(result.error);

      return { pr: result.pr, created: true };
    },
    onSuccess: (data) => {
      // Open PR in browser
      if (data.pr?.url) {
        window.open(data.pr.url, "_blank");
      }
      // Invalidate PR status
      queryClient.invalidateQueries({ queryKey: gitKeys.pr(workingDir) });
    },
  });
}

export function useStageFiles(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files?: string[]) => {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, files }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
    },
  });
}

export function useUnstageFiles(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files?: string[]) => {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, files }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
    },
  });
}

export function useCommitAndPush(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      message,
      branchName,
      push = true,
    }: {
      message: string;
      branchName?: string;
      push?: boolean;
    }) => {
      // Commit
      const commitRes = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDir,
          message,
          branchName,
        }),
      });
      const commitData = await commitRes.json();
      if (!commitRes.ok || commitData.error) {
        throw new Error(commitData.error || "Commit failed");
      }

      // Push if requested
      if (push) {
        const pushRes = await fetch("/api/git/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: workingDir }),
        });
        const pushData = await pushRes.json();
        if (!pushRes.ok || pushData.error) {
          throw new Error(pushData.error || "Push failed");
        }
        return { commit: commitData, push: pushData };
      }

      return { commit: commitData };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
      queryClient.invalidateQueries({ queryKey: gitKeys.pr(workingDir) });
      queryClient.invalidateQueries({ queryKey: gitKeys.history(workingDir) });
    },
  });
}

async function fetchCommitHistory(
  workingDir: string,
  limit: number = 30
): Promise<CommitSummary[]> {
  const res = await fetch(
    `/api/git/history?path=${encodeURIComponent(workingDir)}&limit=${limit}`
  );
  if (!res.ok) throw new Error("Failed to fetch commit history");
  const data = await res.json();
  return data.commits || [];
}

async function fetchCommitDetail(
  workingDir: string,
  hash: string
): Promise<CommitDetail> {
  const res = await fetch(
    `/api/git/history/${hash}?path=${encodeURIComponent(workingDir)}`
  );
  if (!res.ok) throw new Error("Failed to fetch commit detail");
  const data = await res.json();
  return data.commit;
}

async function fetchCommitFileDiff(
  workingDir: string,
  hash: string,
  file: string
): Promise<string> {
  const res = await fetch(
    `/api/git/history/${hash}/diff?path=${encodeURIComponent(workingDir)}&file=${encodeURIComponent(file)}`
  );
  if (!res.ok) throw new Error("Failed to fetch commit file diff");
  const data = await res.json();
  return data.diff || "";
}

export function useCommitHistory(workingDir: string, limit: number = 30) {
  return useQuery({
    queryKey: gitKeys.history(workingDir),
    queryFn: () => fetchCommitHistory(workingDir, limit),
    staleTime: 30000,
    enabled: !!workingDir,
  });
}

export function useCommitDetail(workingDir: string, hash: string | null) {
  return useQuery({
    queryKey: gitKeys.commitDetail(workingDir, hash || ""),
    queryFn: () => fetchCommitDetail(workingDir, hash!),
    staleTime: 60000, // Commit details don't change
    enabled: !!workingDir && !!hash,
  });
}

export function useCommitFileDiff(
  workingDir: string,
  hash: string | null,
  file: string | null
) {
  return useQuery({
    queryKey: gitKeys.commitFileDiff(workingDir, hash || "", file || ""),
    queryFn: () => fetchCommitFileDiff(workingDir, hash!, file!),
    staleTime: 60000, // Diffs don't change
    enabled: !!workingDir && !!hash && !!file,
  });
}

// --- Multi-repo Git Status ---

async function fetchMultiRepoGitStatus(
  projectId?: string,
  fallbackPath?: string
): Promise<MultiRepoGitStatus> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (fallbackPath) params.set("fallbackPath", fallbackPath);

  const res = await fetch(`/api/git/multi-status?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function useMultiRepoGitStatus(
  projectId?: string,
  fallbackPath?: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: gitKeys.multiStatus(projectId || "", fallbackPath),
    queryFn: () => fetchMultiRepoGitStatus(projectId, fallbackPath),
    staleTime: 10000, // Consider fresh for 10s
    refetchInterval: 15000, // Poll every 15s
    enabled: (!!projectId || !!fallbackPath) && (options?.enabled ?? true),
  });
}

// Multi-repo stage/unstage mutations
export function useMultiRepoStageFiles(repoPath: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files?: string[]) => {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: repoPath, files }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      // Invalidate all multi-status queries since we don't know which project
      queryClient.invalidateQueries({
        queryKey: gitKeys.all,
      });
    },
  });
}

export function useMultiRepoUnstageFiles(repoPath: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files?: string[]) => {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: repoPath, files }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      // Invalidate all multi-status queries since we don't know which project
      queryClient.invalidateQueries({
        queryKey: gitKeys.all,
      });
    },
  });
}
