import { slugify } from "../git";

// A new session's worktree starts on a branch that says nothing; it's renamed
// from the session's first message once that has a title.
export const draftFeature = (sessionId: string) =>
  `draft-${sessionId.slice(0, 8)}`;

export function featureFromTitle(title: string, sessionId: string): string {
  const words = slugify(title.split(/\s+/).slice(0, 6).join(" "));
  return words ? `${words}-${sessionId.slice(0, 4)}` : draftFeature(sessionId);
}
