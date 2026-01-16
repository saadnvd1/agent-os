import { useQuery } from "@tanstack/react-query";
import { codeSearchKeys } from "./keys";
import type { FormattedMatch } from "@/lib/code-search";

interface AvailabilityResponse {
  available: boolean;
}

interface SearchResponse {
  results: FormattedMatch[];
  query: string;
  path: string;
  count: number;
  error?: string;
}

async function fetchRipgrepAvailability(): Promise<boolean> {
  const res = await fetch("/api/code-search/available");
  const data: AvailabilityResponse = await res.json();
  return data.available;
}

async function fetchCodeSearch(
  path: string,
  query: string
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    path,
    query,
    maxResults: "100",
    contextLines: "2",
  });

  const res = await fetch(`/api/code-search?${params}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Failed to search code");
  }

  return data;
}

export function useRipgrepAvailable() {
  return useQuery({
    queryKey: codeSearchKeys.available(),
    queryFn: fetchRipgrepAvailability,
    staleTime: Infinity, // Never refetch - ripgrep installation doesn't change during runtime
    gcTime: Infinity,
  });
}

export function useCodeSearch(path: string, query: string, enabled = false) {
  return useQuery({
    queryKey: codeSearchKeys.search(path, query),
    queryFn: () => fetchCodeSearch(path, query),
    enabled: enabled && query.length > 2,
    staleTime: 30000,
    gcTime: 60000,
  });
}
