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

// A repository's key across clones and URL forms: ssh and https of the same
// remote give the same key, with no scheme, credentials, port or ".git".
// "host/path", lower case; null for anything that isn't a remote URL.
export function repoKeyOfRemote(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  let host = "";
  let path = "";
  const scp = /^(?:[^@/:\s]+@)?([^/:\s]+):(?!\/\/)(.+)$/.exec(raw);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    host = scp[1];
    path = scp[2];
  } else {
    try {
      const u = new URL(raw);
      if (!/^(https?|ssh|git):$/.test(u.protocol)) return null;
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  path = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  host = host.toLowerCase();
  return host && path.includes("/") ? `${host}/${path}` : null;
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

const keys = new Map<string, { at: number; key: string | null }>();

export async function repoKey(dir: string): Promise<string | null> {
  const hit = keys.get(dir);
  if (hit && Date.now() - hit.at < SLUG_TTL_MS) return hit.key;
  const url = await git(dir, ["config", "--get", "remote.origin.url"], {
    timeout: 10000,
  }).catch(() => "");
  const key = repoKeyOfRemote(url);
  keys.set(dir, { at: Date.now(), key });
  return key;
}
