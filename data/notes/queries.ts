import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { NoteDoc, SessionNote } from "@/lib/notes/types";
import { noteKeys } from "./keys";

export type { NoteDoc, SessionNote } from "@/lib/notes/types";

const url = (sessionId: string) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/notes`;

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** A session's scratch note. Another device may have changed it, so opening the drawer reads it again. */
export function useSessionNote(
  sessionId: string | null | undefined,
  opts: { fresh?: boolean } = {}
) {
  return useQuery({
    queryKey: noteKeys.session(sessionId ?? ""),
    queryFn: async () => json<SessionNote>(await fetch(url(sessionId!))),
    enabled: !!sessionId,
    staleTime: opts.fresh ? 0 : 60_000,
    refetchOnMount: opts.fresh ? "always" : true,
    refetchOnWindowFocus: false,
  });
}

// keepalive lets a save outlive the page, but only for small bodies.
const KEEPALIVE_MAX = 60_000;

export async function saveSessionNote(
  client: QueryClient,
  sessionId: string,
  doc: NoteDoc
): Promise<void> {
  const body = JSON.stringify({ doc });
  const note = await json<SessionNote>(
    await fetch(url(sessionId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: body.length < KEEPALIVE_MAX,
    })
  );
  client.setQueryData(noteKeys.session(sessionId), note);
}
