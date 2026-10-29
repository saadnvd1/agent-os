import { useQuery } from "@tanstack/react-query";
import type { SessionArtifact } from "@/lib/session-artifacts/types";
import type { PageVersions } from "@/lib/artifacts/actions";
import type { CompareMode, CompareResult } from "@/lib/artifacts/compare/types";
import { sessionArtifactKeys } from "./keys";

export type { SessionArtifact } from "@/lib/session-artifacts/types";

export interface SessionArtifacts {
  artifacts: SessionArtifact[];
  // A linked machine's session: which one, and whether it answered.
  host?: string;
  unreachable?: boolean;
}

export const artifactContentUrl = (sessionId: string, id: string) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(id)}`;

/** What a session made. Read only while the view is open. */
export function useSessionArtifacts(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: sessionArtifactKeys.session(sessionId ?? ""),
    queryFn: async (): Promise<SessionArtifacts> => {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId!)}/artifacts`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load artifacts");
      return data;
    },
    enabled: !!sessionId,
    staleTime: 5_000,
    refetchInterval: 20_000,
  });
}

/** A text artifact's content: markdown, a file, a log. */
export function useArtifactText(url: string | null) {
  return useQuery({
    queryKey: sessionArtifactKeys.content(url ?? ""),
    queryFn: async () => {
      const res = await fetch(url!);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't open it");
      }
      return {
        text: await res.text(),
        truncated: res.headers.get("X-Artifact-Truncated") === "1",
      };
    },
    enabled: !!url,
    staleTime: 5_000,
  });
}

/**
 * Every version of a page, with its note and the message that asked for it.
 * Keyed by page, so any version's card shares one fetch.
 */
export function useArtifactVersions(
  pageId: string,
  artifactId: string,
  enabled = true
) {
  return useQuery({
    queryKey: sessionArtifactKeys.versions(pageId),
    queryFn: async (): Promise<PageVersions> => {
      const res = await fetch(
        `/api/artifacts/${encodeURIComponent(artifactId)}/versions`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load versions");
      return data;
    },
    enabled,
    staleTime: 30_000,
  });
}

/** What changed between two versions of a page. */
export function useArtifactCompare(
  sessionId: string,
  fromId: string,
  toId: string,
  mode: CompareMode,
  enabled = true
) {
  return useQuery({
    queryKey: sessionArtifactKeys.compare(sessionId, fromId, toId, mode),
    queryFn: async (): Promise<Extract<CompareResult, { ok: true }>> => {
      const res = await fetch(
        `${artifactContentUrl(sessionId, fromId)}/compare?to=${encodeURIComponent(toId)}&mode=${mode}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't compare versions");
      return data;
    },
    enabled: enabled && !!fromId && !!toId,
    // Versions never change once saved.
    staleTime: Infinity,
  });
}
