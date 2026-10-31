import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Entry, Head, Page } from "@/lib/whats-new/schema";

export const whatsNewKeys = {
  head: ["whats-new", "head"] as const,
  list: ["whats-new", "list"] as const,
  ahead: ["whats-new", "ahead"] as const,
};

async function get<T>(query: string): Promise<T> {
  const res = await fetch(`/api/whats-new?${query}`);
  if (!res.ok) throw new Error(`What's New failed (${res.status})`);
  return res.json();
}

// A static file that only changes with an update: look rarely.
export const useWhatsNewHead = () =>
  useQuery({
    queryKey: whatsNewKeys.head,
    queryFn: () => get<Head>("head=1"),
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  });

// Read when the dialog opens, a page of days at a time.
export const useWhatsNewList = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: whatsNewKeys.list,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      get<Page>(`limit=60${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (last) =>
      last.hasMore ? last.entries[last.entries.length - 1]?.date : undefined,
    staleTime: 60_000,
  });

export const useWhatsNewAhead = (enabled: boolean) =>
  useQuery({
    queryKey: whatsNewKeys.ahead,
    enabled,
    queryFn: async () => (await get<{ entries: Entry[] }>("ahead=1")).entries,
    staleTime: 5 * 60_000,
  });
