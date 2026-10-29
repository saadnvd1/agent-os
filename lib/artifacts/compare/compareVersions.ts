import { getArtifact, readArtifactHtml } from "../store";
import { toVersion } from "../versions";
import { diffLines } from "./diff";
import { extractText } from "./extractText";
import type { CompareMode, CompareResult } from "./types";

// Per version; bigger pages are only shown side by side.
export const MAX_COMPARE_BYTES = 512 * 1024;

const NOT_FOUND = {
  ok: false,
  status: 404,
  error: "Version not found",
} as const;

// Two versions of one page in one session, as a diff. Both must belong to
// the session asked about and to the same page: an id from anywhere else
// reads as not found, so ids can't be probed across sessions.
export async function compareVersions(
  sessionId: string,
  fromId: string,
  toId: string,
  mode: CompareMode
): Promise<CompareResult> {
  const from = getArtifact(fromId);
  const to = getArtifact(toId);
  if (!from || !to) return NOT_FOUND;
  if (from.session_id !== sessionId || to.session_id !== sessionId)
    return NOT_FOUND;
  if (from.page_id !== to.page_id)
    return {
      ok: false,
      status: 400,
      error: "Those versions belong to different pages",
    };

  const head = {
    ok: true,
    mode,
    from: toVersion(from),
    to: toVersion(to),
  } as const;
  const tooBig = (a: { bytes: number | null }) =>
    (a.bytes ?? 0) > MAX_COMPARE_BYTES;
  const tooLarge = (reason: string): CompareResult => ({
    ...head,
    tooLarge: true,
    reason,
  });
  if (tooBig(from) || tooBig(to)) return tooLarge("too large to diff");

  const [a, b] = await Promise.all([
    readArtifactHtml(from),
    readArtifactHtml(to),
  ]);
  if (a === null || b === null) return NOT_FOUND;
  if (a.length > MAX_COMPARE_BYTES || b.length > MAX_COMPARE_BYTES)
    return tooLarge("too large to diff");

  const result =
    mode === "source"
      ? diffLines(a, b)
      : diffLines(extractText(a), extractText(b));
  if (!result.ok) return tooLarge("too many changes to diff");
  return { ...head, summary: result.summary, lines: result.lines };
}
