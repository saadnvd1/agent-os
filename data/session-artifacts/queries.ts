import { useQuery } from "@tanstack/react-query";
import type { SessionArtifact } from "@/lib/session-artifacts/types";
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
export function useSessionArtifacts(
  sessionId: string | null | undefined,
  enabled = true
) {
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
    enabled: !!sessionId && enabled,
    staleTime: 5_000,
    refetchInterval: enabled ? 20_000 : false,
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
