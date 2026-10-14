// Which GitHub repository a folder is a clone of ("owner/repo", lower
// case), read from its origin's URL as configured, with no gh call. Kept free
// of the task and orchestrator modules so plan checks can use it.

import { git, gitSync } from "./git-exec";

const GITHUB_REMOTE =
  /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/:]+@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export function slugOfRemote(url: string | null | undefined): string | null {
  const m = GITHUB_REMOTE.exec((url ?? "").trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

// A remote's URL doesn't change under a running server often enough to ask
// git on every lookup.
const SLUG_TTL_MS = 5 * 60 * 1000;
const slugs = new Map<string, { at: number; slug: string | null }>();

export async function repoSlug(dir: string): Promise<string | null> {
  const hit = slugs.get(dir);
  if (hit && Date.now() - hit.at < SLUG_TTL_MS) return hit.slug;
  const url = await git(dir, ["config", "--get", "remote.origin.url"], {
    timeout: 10000,
  }).catch(() => "");
  const slug = slugOfRemote(url);
  slugs.set(dir, { at: Date.now(), slug });
  return slug;
}

// The same, without waiting: a cached local `git config` read for callers that
// can't be async. Null when the folder isn't a GitHub clone.
export function repoSlugSync(dir: string): string | null {
  const hit = slugs.get(dir);
  if (hit && Date.now() - hit.at < SLUG_TTL_MS) return hit.slug;
  let url = "";
  try {
    url = gitSync(dir, ["config", "--get", "remote.origin.url"], {
      timeout: 5000,
    });
  } catch {
    url = "";
  }
  const slug = slugOfRemote(url);
  slugs.set(dir, { at: Date.now(), slug });
  return slug;
}
