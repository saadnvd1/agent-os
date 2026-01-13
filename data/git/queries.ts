import { useQuery } from "@tanstack/react-query";
import { gitKeys } from "./keys";
import type { CommitSummary, CommitDetail } from "@/lib/git-history";

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
